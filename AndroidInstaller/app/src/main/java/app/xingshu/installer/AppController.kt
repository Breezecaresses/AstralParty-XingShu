package app.xingshu.installer

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.provider.OpenableColumns
import android.provider.Settings
import android.util.LruCache
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import io.github.muntashirakon.adb.android.AdbMdns
import org.json.JSONObject
import rikka.shizuku.Shizuku
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.regex.Pattern
import javax.net.ssl.HttpsURLConnection

enum class NavTab(val label: String) {
    LAUNCH("启动"),
    MODS("模组"),
    WORKSHOP("工坊"),
    CUSTOMIZE("自定义"),
    SETTINGS("设置"),
}

data class ChannelEntry(
    val packageName: String,
    val label: String,
    val platform: String,
    val versionName: String,
    val hasCatalog: Boolean,
    val running: Boolean,
    val installState: String,
    val resolvedRel: String,
)

data class InstalledModEntry(
    val id: String,
    val name: String,
    val version: String,
    val sha256: String,
    val installKind: String,
    val declaredCount: Int,
    val presentCount: Int,
) {
    fun isXspkgModule(): Boolean = installKind.equals("xspkg", ignoreCase = true)
}

data class RuntimeProgressState(
    val active: Boolean = false,
    val received: Long = 0L,
    val total: Long = 0L,
    val speed: Long = 0L,
    val stage: String = "",
)

data class ModProgressState(
    val modId: String = "",
    val received: Long = 0L,
    val total: Long = 0L,
    val speed: Long = 0L,
    val stage: String = "",
)

data class ConflictPrompt(
    val packageName: String,
    val hash: String,
    val summary: String,
)

@Stable
internal class AppController(private val activity: Activity) {
    private val appContext: Context = activity.applicationContext
    private val prefs: SharedPreferences = activity.getPreferences(Context.MODE_PRIVATE)

    private val worker = Executors.newSingleThreadExecutor()
    private val workshopWorker = Executors.newCachedThreadPool()
    private val authWorker = Executors.newSingleThreadExecutor()
    private val updateWorker = Executors.newSingleThreadExecutor()
    private val thumbWorker = Executors.newFixedThreadPool(3)
    private val updateTaskActive = AtomicBoolean(false)

    private val thumbCache = object : LruCache<String, ImageBitmap>(24) {}
    private val thumbPending = mutableSetOf<String>()

    var activeTab by mutableStateOf(NavTab.LAUNCH)
    var snackbarMessage by mutableStateOf<String?>(null)

    // Transport & privilege state
    var useShizuku by mutableStateOf(false)
    var bindingShizuku by mutableStateOf(false)
    var remoteBinder by mutableStateOf<IInstaller?>(null)
    private var localAdb: LocalAdbInstaller? = null
    var adbConnected by mutableStateOf(false)
    var connectedHost by mutableStateOf("127.0.0.1")
    var discoveredConnectPort by mutableIntStateOf(-1)
    var discoveredPairingPort by mutableIntStateOf(-1)
    private var discoveredConnectHost: String? = null
    private var lastAutoTriedPort: Int = -1
    @Volatile private var connectDiscoveryLatch: CountDownLatch? = null

    var connectionPortInput by mutableStateOf("")
    var pairingPortInput by mutableStateOf("")
    var pairingCodeInput by mutableStateOf("")
    var showConnectSheet by mutableStateOf(false)

    private var connectMdns: AdbMdns? = null
    private var legacyConnectMdns: AdbMdns? = null
    private var pairingMdns: AdbMdns? = null

    // Busy / log / diagnostics
    var busy by mutableStateOf(false)
    var modTaskBusy by mutableStateOf(false)
    var batchModsBusy by mutableStateOf(false)
    var statusText by mutableStateOf("就绪：可直接启动官方原版游戏；连接授权后可按需安装官方插件或功能模组。")
    var lastResultText by mutableStateOf("")
    var logExpanded by mutableStateOf(false)
    val logs = mutableStateListOf<String>()
    var runtimeProgress by mutableStateOf(RuntimeProgressState())
    var conflictPrompt by mutableStateOf<ConflictPrompt?>(null)
    var cacheBytes by mutableLongStateOf(0L)
    var coreSpec by mutableStateOf(CoreRuntimeSpec.embedded())
    @Volatile private var lastShizukuSpecJson: String? = null

    // Game channels
    val channels = mutableStateListOf<ChannelEntry>()
    var selectedPackageName by mutableStateOf(GamePackageCatalog.DEFAULT_PACKAGE)

    // Official modular switches + installed workshop mods
    val officialModuleStates = mutableStateMapOf<String, String>()
    val installedMods = mutableStateListOf<InstalledModEntry>()
    var activeModuleCount by mutableIntStateOf(0)
    var totalModPngCount by mutableIntStateOf(0)

    // Workshop state
    val workshopMods = mutableStateListOf<AndroidWorkshopClient.WorkshopMod>()
    var workshopLoading by mutableStateOf(false)
    var workshopError by mutableStateOf("")
    var modProgress by mutableStateOf(ModProgressState())
    val thumbnails = mutableStateMapOf<String, ImageBitmap>()
    var pendingWorkshopPromptMod by mutableStateOf<AndroidWorkshopClient.WorkshopMod?>(null)
    var workshopDetailMod by mutableStateOf<AndroidWorkshopClient.WorkshopMod?>(null)

    // Appearance state
    var themeId by mutableStateOf(ThemePalette.DEFAULT_THEME_ID)
    var customThemeHex by mutableStateOf(ThemePalette.DEFAULT_CUSTOM_HEX)
    var brightnessMode by mutableStateOf(ThemeBrightnessMode.SYSTEM)
    var wallpaperBitmap by mutableStateOf<ImageBitmap?>(null)
    var wallpaperAlpha by mutableFloatStateOf(0.28f)

    // Auth / Cloud session
    var boundSession by mutableStateOf<MobileAuthHub.BoundAccount?>(null)
    var cloudSummary by mutableStateOf("")
    var authBusy by mutableStateOf(false)
    var webLoginUrl by mutableStateOf("")
    var qqLinkInput by mutableStateOf("")
    var pendingQqHandoff by mutableStateOf("")
    var pendingQqRequester by mutableStateOf("")
    val detectedTokens = mutableStateListOf<BnSdkTokenExtractor.ChannelToken>()
    var selectedTokenIndex by mutableIntStateOf(0)
    var authStatusText by mutableStateOf("")
    @Volatile private var webPollCancelled = false

    // Updates
    var previewUpdates by mutableStateOf(false)
    var availableUpdate by mutableStateOf<ReleaseUpdates.Update?>(null)
    var showUpdateModal by mutableStateOf(false)
    var updateDownloading by mutableStateOf(false)
    var updateVerifying by mutableStateOf(false)
    var updateProgressPct by mutableIntStateOf(0)
    var updateStatusText by mutableStateOf("点击检查是否存在官方版本更新")

    @Volatile private var disposed = false
    var onPickLocalArchiveRequest: (() -> Unit)? = null
    var onPickWallpaperRequest: (() -> Unit)? = null
    var onExportLogRequest: ((String) -> Unit)? = null

    private val shizukuServiceArgs = Shizuku.UserServiceArgs(
        ComponentName(BuildConfig.APPLICATION_ID, InstallerService::class.java.name)
    )
        .daemon(false)
        .processNameSuffix("installer")
        .debuggable(false)
        .version(BuildConfig.VERSION_CODE)

    private val shizukuReceived = Shizuku.OnBinderReceivedListener {
        activity.runOnUiThread { appendLog("检测到 Shizuku 服务在线。") }
    }

    private val shizukuDead = Shizuku.OnBinderDeadListener {
        activity.runOnUiThread {
            remoteBinder = null
            lastShizukuSpecJson = null
            bindingShizuku = false
            appendLog("Shizuku 服务连接已断开。")
        }
    }

    private val shizukuPermissionListener = Shizuku.OnRequestPermissionResultListener { _, result ->
        activity.runOnUiThread {
            if (result == PackageManager.PERMISSION_GRANTED) {
                connectShizuku()
            } else {
                toast("未授予 Shizuku 权限，请在 Shizuku 应用管理中允许星枢。")
            }
        }
    }

    private val shizukuConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            remoteBinder = IInstaller.Stub.asInterface(binder)
            lastShizukuSpecJson = null
            useShizuku = true
            bindingShizuku = false
            appendLog("Shizuku 授权通道已就绪。")
            scanPackagesAndInspect()
            refreshInstalledModsAsync()
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            remoteBinder = null
            lastShizukuSpecJson = null
            bindingShizuku = false
        }
    }

    fun initialize(initialIntent: Intent?) {
        boundSession = MobileAuthHub.loadSession(prefs)
        val savedPkg = prefs.getString("selectedPackageName", GamePackageCatalog.DEFAULT_PACKAGE)
        if (GamePackageCatalog.isValidPackageName(savedPkg)) {
            selectedPackageName = savedPkg!!
        }
        themeId = prefs.getString("themeId", ThemePalette.DEFAULT_THEME_ID) ?: ThemePalette.DEFAULT_THEME_ID
        customThemeHex = ThemePalette.normalizeHex(prefs.getString("customThemeHex", ThemePalette.DEFAULT_CUSTOM_HEX))
        brightnessMode = ThemeBrightnessMode.fromPref(
            prefs.getString("brightnessMode", if (prefs.getBoolean("customThemeDark", false)) "dark" else "system")
        )
        wallpaperAlpha = prefs.getFloat("wallpaperAlpha", 0.28f).coerceIn(0.08f, 0.72f)
        connectionPortInput = prefs.getString("connectionPort", "") ?: ""
        previewUpdates = prefs.getBoolean("previewUpdates", false)

        loadSavedWallpaperAsync()
        refreshCacheBytes()
        scanOfflinePackages()

        try {
            Shizuku.addBinderReceivedListenerSticky(shizukuReceived)
            Shizuku.addBinderDeadListener(shizukuDead)
            Shizuku.addRequestPermissionResultListener(shizukuPermissionListener)
        } catch (_: Throwable) {
        }

        handleIntent(initialIntent)
        worker.execute {
            try {
                resolveCoreSpecBlocking(forceRefresh = false)
            } catch (_: Exception) {
            }
        }
        refreshWorkshopAsync()
        checkAssistantUpdate(silent = true)

        if (boundSession != null) {
            refreshCloudAccountAsync()
        }
    }

    fun onStart() {
        startMdnsDiscovery()
    }

    fun onStop() {
        stopMdnsDiscovery()
    }

    fun onResume() {
        if (prefs.getBoolean("waitingInstallPermission", false)) {
            prefs.edit().putBoolean("waitingInstallPermission", false).apply()
            requestInstallPendingUpdateApk()
        }
        resumePendingWebAuthIfNeeded()
    }

    fun dispose() {
        disposed = true
        webPollCancelled = true
        stopMdnsDiscovery()
        try {
            Shizuku.removeBinderReceivedListener(shizukuReceived)
            Shizuku.removeBinderDeadListener(shizukuDead)
            Shizuku.removeRequestPermissionResultListener(shizukuPermissionListener)
        } catch (_: Throwable) {
        }
        val currentLocal = localAdb
        val shouldUnbindShizuku = remoteBinder != null
        try {
            Executors.newSingleThreadExecutor().apply {
                execute {
                    try { currentLocal?.close() } catch (_: Exception) {}
                    try {
                        if (shouldUnbindShizuku && Shizuku.pingBinder()) {
                            Shizuku.unbindUserService(shizukuServiceArgs, shizukuConnection, true)
                        }
                    } catch (_: Exception) {}
                    shutdown()
                }
            }
        } catch (_: Throwable) {
        }
        worker.shutdownNow()
        workshopWorker.shutdownNow()
        authWorker.shutdownNow()
        updateWorker.shutdownNow()
        thumbWorker.shutdownNow()
    }

    fun isPrivilegeReady(): Boolean = (useShizuku && remoteBinder != null) || (!useShizuku && adbConnected)

    fun selectedChannel(): ChannelEntry? =
        channels.firstOrNull { it.packageName == selectedPackageName } ?: channels.firstOrNull()

    fun selectChannel(packageName: String) {
        if (!GamePackageCatalog.isValidPackageName(packageName)) return
        selectedPackageName = packageName
        prefs.edit().putString("selectedPackageName", packageName).apply()
        if (isPrivilegeReady()) {
            inspectSelectedAsync()
            refreshInstalledModsAsync()
        }
    }

    fun toast(msg: String) {
        snackbarMessage = msg
        appendLog(msg)
    }

    fun consumeSnackbar() {
        snackbarMessage = null
    }

    fun appendLog(msg: String) {
        if (disposed || msg.isBlank()) return
        val stamp = SimpleDateFormat("HH:mm:ss", Locale.CHINA).format(Date())
        logs.add(0, "[$stamp] $msg")
        if (logs.size > 60) {
            logs.removeRange(60, logs.size)
        }
        statusText = msg.lineSequence().firstOrNull() ?: msg
    }

    private fun requireLocalAdb(): LocalAdbInstaller {
        val current = localAdb
        if (current != null) return current
        val created = LocalAdbInstaller(appContext)
        localAdb = created
        return created
    }

    private fun scanOfflinePackages() {
        val pm = appContext.packageManager
        val discovered = mutableListOf<ChannelEntry>()
        val knownCandidates = listOf(
            "com.feimo.astralparty",
            "com.feimo.jxpd.mi",
            "com.feimo.astralparty.bilibili",
            "com.feimo.jxpd.bili",
            "com.feimo.astralparty.huawei",
            "com.feimo.jxpd.huawei",
            "com.feimo.astralparty.nearme.gamecenter",
            "com.feimo.astralparty.vivo",
            "com.tencent.tmgp.astralparty",
        )
        for (pkg in knownCandidates) {
            try {
                @Suppress("DEPRECATION")
                val info = pm.getPackageInfo(pkg, 0)
                val meta = GamePackageCatalog.classifyPackage(pkg)
                discovered.add(
                    ChannelEntry(
                        packageName = pkg,
                        label = meta.label,
                        platform = meta.platform,
                        versionName = info.versionName ?: "",
                        hasCatalog = false,
                        running = false,
                        installState = "unverified",
                        resolvedRel = "",
                    )
                )
            } catch (_: PackageManager.NameNotFoundException) {
            }
        }
        if (discovered.isNotEmpty()) {
            channels.clear()
            channels.addAll(discovered)
            if (discovered.none { it.packageName == selectedPackageName }) {
                selectedPackageName = discovered.first().packageName
            }
        }
    }

    fun launchSelectedGame() {
        val pkg = selectedChannel()?.packageName ?: selectedPackageName
        val session = boundSession
        try {
            val launch = appContext.packageManager.getLaunchIntentForPackage(pkg)
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
                if (session != null && session.token.isNotEmpty()) {
                    authWorker.execute {
                        try {
                            val handoff = MobileAuthHub.prepareGameHandoff(session)
                            val handoffJson = LocalHandoffBridge.buildHandoffJson(handoff.token, handoff.uid)
                            if (isPrivilegeReady()) {
                                val res = if (useShizuku) {
                                    remoteBinder?.writeGameHandoff(pkg, handoffJson)
                                } else {
                                    requireLocalAdb().writeGameHandoff(pkg, handoffJson)
                                }
                                if (res == "OK") {
                                    LocalHandoffBridge.publish(handoff.token, handoff.uid)
                                }
                            } else {
                                LocalHandoffBridge.publish(handoff.token, handoff.uid)
                            }
                        } catch (_: Exception) {
                        }
                    }
                }
                activity.startActivity(launch)
                toast("已纯净启动游戏：${GamePackageCatalog.classifyPackage(pkg).label}")
                return
            }
        } catch (_: Exception) {
        }

        if (isPrivilegeReady()) {
            worker.execute {
                val res = try {
                    if (useShizuku) remoteBinder!!.launchGame(pkg) else requireLocalAdb().launchGame(pkg)
                } catch (e: Exception) {
                    "启动失败：${e.message}"
                }
                activity.runOnUiThread {
                    if (!disposed) toast(res)
                }
            }
            return
        }
        toast("未找到所选渠道（$pkg），请确认游戏已安装后点「刷新渠道」。")
    }

    // ---- Shizuku & Wireless ADB ----

    fun connectShizuku() {
        if (busy || bindingShizuku) return
        useShizuku = true
        try {
            if (!Shizuku.pingBinder()) {
                useShizuku = false
                toast("未检测到 Shizuku 服务运行，可打开 Shizuku 后重试或改用无线调试。")
                return
            }
            if (Shizuku.checkSelfPermission() != PackageManager.PERMISSION_GRANTED) {
                Shizuku.requestPermission(1)
                return
            }
            val current = remoteBinder
            if (current != null) {
                scanPackagesAndInspect()
                refreshInstalledModsAsync()
            } else {
                bindingShizuku = true
                Shizuku.bindUserService(shizukuServiceArgs, shizukuConnection)
                appendLog("正在绑定 Shizuku 特权服务…")
            }
        } catch (e: Exception) {
            bindingShizuku = false
            useShizuku = false
            toast("Shizuku 绑定失败：${e.message}")
        }
    }

    fun startMdnsDiscovery() {
        if (disposed || Build.VERSION.SDK_INT < 30) return
        val sysPort = LocalAdbInstaller.tryDiscoverSystemAdbPort()
        if (sysPort >= 1024) {
            onConnectPortDiscovered(null, sysPort)
        }
        if (connectMdns == null) {
            connectMdns = AdbMdns(appContext, AdbMdns.SERVICE_TYPE_TLS_CONNECT) { addr, port ->
                onConnectPortDiscovered(addr, port)
            }.also { try { it.start() } catch (_: Exception) {} }
        }
        if (legacyConnectMdns == null) {
            legacyConnectMdns = AdbMdns(appContext, AdbMdns.SERVICE_TYPE_ADB) { addr, port ->
                onConnectPortDiscovered(addr, port)
            }.also { try { it.start() } catch (_: Exception) {} }
        }
        if (pairingMdns == null) {
            pairingMdns = AdbMdns(appContext, AdbMdns.SERVICE_TYPE_TLS_PAIRING) { _, port ->
                if (port >= 1024) {
                    activity.runOnUiThread {
                        if (!disposed) {
                            discoveredPairingPort = port
                            if (pairingPortInput.isBlank()) pairingPortInput = port.toString()
                        }
                    }
                }
            }.also { try { it.start() } catch (_: Exception) {} }
        }
    }

    fun stopMdnsDiscovery() {
        try { connectMdns?.stop() } catch (_: Exception) {}
        try { legacyConnectMdns?.stop() } catch (_: Exception) {}
        try { pairingMdns?.stop() } catch (_: Exception) {}
        connectMdns = null
        legacyConnectMdns = null
        pairingMdns = null
    }

    private fun onConnectPortDiscovered(addr: InetAddress?, port: Int) {
        if (port < 1024) return
        val host = (addr as? Inet4Address)?.hostAddress
        discoveredConnectHost = host
        connectDiscoveryLatch?.countDown()
        activity.runOnUiThread {
            if (disposed) return@runOnUiThread
            discoveredConnectPort = port
            if (connectionPortInput.isBlank()) connectionPortInput = port.toString()
            val previouslyPaired = prefs.getBoolean("wirelessPaired", false) ||
                !prefs.getString("connectionPort", "").isNullOrEmpty()
            if (previouslyPaired && discoveredPairingPort < 1024) {
                trySilentAutoConnect(host, port)
            }
        }
    }

    private fun trySilentAutoConnect(host: String?, port: Int) {
        if (disposed || busy || bindingShizuku || useShizuku || adbConnected || port < 1024) return
        if (lastAutoTriedPort == port) return
        lastAutoTriedPort = port
        worker.execute {
            if (disposed || useShizuku) return@execute
            try {
                val adb = requireLocalAdb()
                if (adb.connected()) return@execute
                adb.connect(host, port)
                val scanJson = adb.scanPackages()
                val modJson = adb.listInstalledMods(selectedPackageName)
                activity.runOnUiThread {
                    if (disposed) return@runOnUiThread
                    adbConnected = true
                    connectedHost = adb.connectedHost()
                    prefs.edit().putString("connectionPort", port.toString()).putBoolean("wirelessPaired", true).apply()
                    applyScannedPackages(scanJson)
                    applyListedMods(modJson)
                    appendLog("已自动连接无线调试：${adb.connectedHost()}:$port")
                }
            } catch (_: Exception) {
            }
        }
    }

    fun pairAndConnectLocalAdb() {
        if (busy) return
        val pairPort = try { LocalPort.parse(pairingPortInput.trim()) } catch (e: Exception) {
            toast(e.message ?: "配对端口无效")
            return
        }
        val code = pairingCodeInput.trim()
        if (!code.matches(Regex("^\\d{6}$"))) {
            toast("请输入系统弹窗中的 6 位数字配对码。")
            return
        }
        busy = true
        appendLog("正在通过本机无线调试配对端口 $pairPort…")
        worker.execute {
            try {
                val adb = requireLocalAdb()
                adb.pair(null, pairPort, code)
                activity.runOnUiThread {
                    prefs.edit().putBoolean("wirelessPaired", true).apply()
                }
                var connPort = discoveredConnectPort
                var connHost = discoveredConnectHost
                if (connPort < 1024) {
                    val latch = CountDownLatch(1)
                    connectDiscoveryLatch = latch
                    try { latch.await(2400, TimeUnit.MILLISECONDS) } catch (_: InterruptedException) {}
                    connectDiscoveryLatch = null
                    connPort = discoveredConnectPort
                    connHost = discoveredConnectHost
                }
                if (connPort >= 1024) {
                    adb.connect(connHost, connPort)
                    val scanJson = adb.scanPackages()
                    val modJson = adb.listInstalledMods(selectedPackageName)
                    activity.runOnUiThread {
                        if (disposed) return@runOnUiThread
                        busy = false
                        adbConnected = true
                        useShizuku = false
                        connectedHost = adb.connectedHost()
                        connectionPortInput = connPort.toString()
                        prefs.edit().putString("connectionPort", connPort.toString()).apply()
                        applyScannedPackages(scanJson)
                        applyListedMods(modJson)
                        showConnectSheet = false
                        toast("配对并连接无线调试成功（${adb.connectedHost()}:$connPort）")
                    }
                } else {
                    activity.runOnUiThread {
                        busy = false
                        toast("配对成功！请关闭系统配对弹窗并点击「连接无线调试」。")
                    }
                }
            } catch (e: Exception) {
                activity.runOnUiThread {
                    busy = false
                    toast(e.message ?: "无线调试配对失败")
                }
            }
        }
    }

    fun connectLocalAdb() {
        if (busy) return
        val manualPort = if (connectionPortInput.isNotBlank()) {
            try { LocalPort.parse(connectionPortInput.trim()) } catch (e: Exception) {
                toast(e.message ?: "连接端口无效")
                return
            }
        } else null
        busy = true
        appendLog("正在查找并连接本机无线调试…")
        worker.execute {
            try {
                var targetPort = manualPort ?: discoveredConnectPort
                var targetHost = discoveredConnectHost
                if (targetPort < 1024) {
                    val latch = CountDownLatch(1)
                    connectDiscoveryLatch = latch
                    activity.runOnUiThread { startMdnsDiscovery() }
                    try { latch.await(2600, TimeUnit.MILLISECONDS) } catch (_: InterruptedException) {}
                    connectDiscoveryLatch = null
                    targetPort = discoveredConnectPort
                    targetHost = discoveredConnectHost
                }
                if (targetPort < 1024) {
                    targetPort = LocalAdbInstaller.tryDiscoverSystemAdbPort()
                }
                if (targetPort < 1024) {
                    throw IOException("未发现可用无线调试端口，请开启开发者选项「无线调试」并核对端口号。")
                }
                val adb = requireLocalAdb()
                val spec = resolveCoreSpecBlocking(forceRefresh = false)
                adb.connect(targetHost, targetPort)
                adb.syncCoreSpec(spec)
                val scanJson = adb.scanPackages()
                val modJson = adb.listInstalledMods(selectedPackageName)
                activity.runOnUiThread {
                    if (disposed) return@runOnUiThread
                    busy = false
                    adbConnected = true
                    useShizuku = false
                    connectedHost = adb.connectedHost()
                    connectionPortInput = targetPort.toString()
                    prefs.edit().putString("connectionPort", targetPort.toString()).putBoolean("wirelessPaired", true).apply()
                    applyScannedPackages(scanJson)
                    applyListedMods(modJson)
                    showConnectSheet = false
                    toast("无线调试已连接（${adb.connectedHost()}:$targetPort）")
                }
            } catch (e: Exception) {
                activity.runOnUiThread {
                    busy = false
                    adbConnected = false
                    toast(e.message ?: "无线调试连接失败")
                }
            }
        }
    }

    fun openWirelessSettings() {
        try {
            activity.startActivity(Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS))
        } catch (_: Exception) {
            try { activity.startActivity(Intent(Settings.ACTION_SETTINGS)) } catch (_: Exception) {}
        }
    }

    // ---- Scanning & Core Plugin Mod ----

    private fun resolveCoreSpecBlocking(forceRefresh: Boolean): CoreRuntimeSpec {
        val resolved = CoreRuntimeSpec.resolve(appContext.filesDir, BuildConfig.VERSION_CODE, forceRefresh)
        activity.runOnUiThread {
            if (!disposed) {
                coreSpec = resolved
            }
        }
        return resolved
    }

    private fun syncCoreSpecToPrivilegeBlocking(spec: CoreRuntimeSpec) {
        if (useShizuku) {
            val binder = remoteBinder ?: throw IOException("Shizuku 服务未就绪")
            val canonical = spec.toCanonicalJson()
            if (canonical != lastShizukuSpecJson) {
                val parsed = MiniJson.parseObject(binder.setCoreSpec(canonical))
                if (parsed["ok"] != true) {
                    throw IOException(MiniJson.stringField(parsed, "error").ifEmpty { "同步核心组件清单失败" })
                }
                lastShizukuSpecJson = canonical
            }
        } else {
            requireLocalAdb().syncCoreSpec(spec)
        }
    }

    fun scanPackagesAndInspect() {
        if (!isPrivilegeReady()) {
            scanOfflinePackages()
            worker.execute {
                try {
                    resolveCoreSpecBlocking(forceRefresh = true)
                } catch (_: Exception) {
                }
            }
            toast("已刷新本地已安装渠道列表；连接无线调试或 Shizuku 后可管理模组。")
            return
        }
        val pkg = selectedPackageName
        busy = true
        worker.execute {
            try {
                val spec = resolveCoreSpecBlocking(forceRefresh = true)
                syncCoreSpecToPrivilegeBlocking(spec)
                val scanJson = if (useShizuku) remoteBinder!!.scanPackages() else requireLocalAdb().scanPackages()
                val inspectOut = if (useShizuku) remoteBinder!!.inspect(pkg) else requireLocalAdb().inspect(pkg)
                activity.runOnUiThread {
                    if (disposed) return@runOnUiThread
                    busy = false
                    applyScannedPackages(scanJson)
                    lastResultText = inspectOut
                    appendLog("渠道检测完成：${inspectOut.lineSequence().firstOrNull() ?: ""}")
                }
                refreshInstalledModsAsync()
            } catch (e: Exception) {
                activity.runOnUiThread {
                    busy = false
                    toast("扫描失败：${e.message}")
                }
            }
        }
    }

    fun inspectSelectedAsync() {
        if (!isPrivilegeReady() || busy) return
        val pkg = selectedPackageName
        busy = true
        worker.execute {
            val out = try {
                val spec = resolveCoreSpecBlocking(forceRefresh = true)
                syncCoreSpecToPrivilegeBlocking(spec)
                if (useShizuku) remoteBinder!!.inspect(pkg) else requireLocalAdb().inspect(pkg)
            } catch (e: Exception) {
                "检查未通过：${e.message}"
            }
            activity.runOnUiThread {
                if (disposed) return@runOnUiThread
                busy = false
                lastResultText = out
                appendLog(out.lineSequence().take(2).joinToString(" "))
            }
        }
    }

    fun installOrRestoreCorePlugin(restore: Boolean, conflictHash: String? = null) {
        if (busy) return
        if (!isPrivilegeReady()) {
            showConnectSheet = true
            toast("请先连接无线调试或 Shizuku 服务。")
            return
        }
        val pkg = selectedPackageName
        busy = true
        worker.execute {
            try {
                val spec = resolveCoreSpecBlocking(forceRefresh = true)
                syncCoreSpecToPrivilegeBlocking(spec)
                if (!restore && conflictHash == null) {
                    val preflight = if (useShizuku) remoteBinder!!.inspect(pkg) else requireLocalAdb().inspect(pkg)
                    if (!preflight.startsWith("游戏版本匹配") || preflight.contains("游戏仍在运行")) {
                        activity.runOnUiThread {
                            busy = false
                            lastResultText = preflight
                            toast(preflight)
                        }
                        return@execute
                    }
                    if (preflight.contains("同位置覆盖冲突")) {
                        val m = Pattern.compile("冲突文件SHA256：([a-f0-9]{64})").matcher(preflight)
                        if (m.find()) {
                            val hash = m.group(1)!!
                            activity.runOnUiThread {
                                busy = false
                                lastResultText = preflight
                                conflictPrompt = ConflictPrompt(pkg, hash, preflight)
                            }
                            return@execute
                        }
                    }
                }

                val out = applyCorePluginBlocking(pkg, restore, conflictHash, spec)
                val scanJson = if (useShizuku) remoteBinder!!.scanPackages() else requireLocalAdb().scanPackages()
                activity.runOnUiThread {
                    if (disposed) return@runOnUiThread
                    busy = false
                    runtimeProgress = RuntimeProgressState()
                    lastResultText = out
                    applyScannedPackages(scanJson)
                    refreshCacheBytes()
                    toast(out.lineSequence().firstOrNull() ?: out)
                }
                refreshInstalledModsAsync()
            } catch (e: Exception) {
                activity.runOnUiThread {
                    if (disposed) return@runOnUiThread
                    busy = false
                    runtimeProgress = RuntimeProgressState()
                    toast(e.message ?: "操作未完成")
                }
            }
        }
    }

    private fun applyCorePluginBlocking(
        pkg: String,
        restore: Boolean,
        conflictHash: String?,
        spec: CoreRuntimeSpec = resolveCoreSpecBlocking(forceRefresh = false),
    ): String {
        val cacheDir = PayloadDownloadManager.cacheDir(appContext)
        val total = if (restore) spec.vanillaSize else spec.candidateSize
        activity.runOnUiThread {
            runtimeProgress = RuntimeProgressState(
                active = true,
                received = 0L,
                total = total,
                speed = 0L,
                stage = if (restore) "正在下载官方原版还原包…" else "正在下载星枢官方插件 Mod ${spec.runtimeVersion}…",
            )
        }
        val listener = PayloadDownloadManager.ProgressListener { rec, tot, spd, st ->
            activity.runOnUiThread {
                runtimeProgress = RuntimeProgressState(true, rec, tot, spd, st)
            }
        }
        val candidateFile = if (restore) null else PayloadDownloadManager.ensureDownloaded(
            cacheDir,
            spec.candidateUrl,
            spec.patchSha256,
            spec.candidateSize,
            "星枢官方插件 Mod ${spec.runtimeVersion}",
            listener,
        )
        val vanillaFile = if (restore) PayloadDownloadManager.ensureDownloaded(
            cacheDir,
            spec.vanillaUrl,
            spec.vanillaSha256,
            spec.vanillaSize,
            "官方原版备份",
            listener,
        ) else null

        activity.runOnUiThread {
            runtimeProgress = RuntimeProgressState(
                active = true,
                received = total,
                total = total,
                speed = 0L,
                stage = if (restore) "正在无损还原官方原版…" else "正在校验并安装星枢官方插件 Mod…",
            )
        }
        if (!useShizuku) {
            return requireLocalAdb().apply(pkg, restore, conflictHash, candidateFile, vanillaFile)
        }
        val binder = remoteBinder!!
        val pfdCandidate = candidateFile?.let { ParcelFileDescriptor.open(it, ParcelFileDescriptor.MODE_READ_ONLY) }
        val pfdVanilla = vanillaFile?.let { ParcelFileDescriptor.open(it, ParcelFileDescriptor.MODE_READ_ONLY) }
        return try {
            binder.apply(pkg, restore, conflictHash, pfdCandidate, pfdVanilla)
        } finally {
            try { pfdCandidate?.close() } catch (_: Exception) {}
            try { pfdVanilla?.close() } catch (_: Exception) {}
        }
    }

    // ---- 18 Official Modules & Mods Management ----

    fun refreshInstalledModsAsync() {
        if (!isPrivilegeReady()) return
        val pkg = selectedPackageName
        worker.execute {
            try {
                val json = if (useShizuku) remoteBinder!!.listInstalledMods(pkg) else requireLocalAdb().listInstalledMods(pkg)
                activity.runOnUiThread {
                    if (!disposed) applyListedMods(json)
                }
            } catch (_: Exception) {
            }
        }
    }

    fun toggleOfficialModule(id: String, enable: Boolean) {
        if (!OfficialModulesCatalog.isSafeId(id) || busy || batchModsBusy) return
        if (!isPrivilegeReady()) {
            showConnectSheet = true
            toast("请先连接无线调试或 Shizuku，再启停功能模组。")
            return
        }
        val pkg = selectedPackageName
        batchModsBusy = true
        worker.execute {
            try {
                val respJson = if (useShizuku) {
                    remoteBinder!!.setOfficialModules(pkg, id, enable, false)
                } else {
                    requireLocalAdb().setOfficialModules(pkg, id, enable, false)
                }
                val parsed = MiniJson.parseObject(respJson)
                activity.runOnUiThread {
                    batchModsBusy = false
                    if (disposed) return@runOnUiThread
                    if (parsed["ok"] == true) {
                        applyOfficialModulesMap(parsed["officialModules"])
                        activeModuleCount = MiniJson.longField(parsed, "activeModuleCount", activeModuleCount.toLong()).toInt()
                        val modName = OfficialModulesCatalog.ALL.firstOrNull { it.id == id }?.name ?: id
                        toast(if (enable) "已开启「$modName」" else "已关闭「$modName」")
                    } else {
                        toast(MiniJson.stringField(parsed, "error").ifEmpty { "切换模组失败" })
                    }
                }
            } catch (e: Exception) {
                activity.runOnUiThread {
                    batchModsBusy = false
                    toast("切换失败：${e.message}")
                }
            }
        }
    }

    fun installAllOfficialModules(includeCore: Boolean = true) {
        if (busy || batchModsBusy) return
        if (!isPrivilegeReady()) {
            showConnectSheet = true
            toast("请先连接无线调试或 Shizuku，即可一键安装全部 ${OfficialModulesCatalog.ALL.size} 项官方模组。")
            return
        }
        val pkg = selectedPackageName
        val currentState = selectedChannel()?.installState ?: ""
        val prevRuntime = coreSpec.runtimeVersion
        batchModsBusy = true
        worker.execute {
            try {
                val spec = resolveCoreSpecBlocking(forceRefresh = true)
                syncCoreSpecToPrivilegeBlocking(spec)
                var coreInstalledNow = false
                if (includeCore && (currentState != "installed" || spec.runtimeVersion != prevRuntime)) {
                    val out = applyCorePluginBlocking(pkg, restore = false, conflictHash = null, spec = spec)
                    if (out.startsWith("未完成") || out.startsWith("检查未通过") || out.contains("同位置覆盖冲突")) {
                        val scanJson = if (useShizuku) remoteBinder!!.scanPackages() else requireLocalAdb().scanPackages()
                        activity.runOnUiThread {
                            batchModsBusy = false
                            runtimeProgress = RuntimeProgressState()
                            applyScannedPackages(scanJson)
                            toast(out)
                        }
                        return@execute
                    }
                    coreInstalledNow = true
                }
                val csv = OfficialModulesCatalog.allIdsCsv()
                val respJson = if (useShizuku) {
                    remoteBinder!!.setOfficialModules(pkg, csv, true, false)
                } else {
                    requireLocalAdb().setOfficialModules(pkg, csv, true, false)
                }
                val parsed = MiniJson.parseObject(respJson)
                val scanJson = if (useShizuku) remoteBinder!!.scanPackages() else requireLocalAdb().scanPackages()
                activity.runOnUiThread {
                    batchModsBusy = false
                    runtimeProgress = RuntimeProgressState()
                    if (disposed) return@runOnUiThread
                    applyScannedPackages(scanJson)
                    if (parsed["ok"] == true) {
                        applyOfficialModulesMap(parsed["officialModules"])
                        activeModuleCount = MiniJson.longField(parsed, "activeModuleCount", 18L).toInt()
                        toast(
                            if (coreInstalledNow) {
                                "已一键安装「星枢官方插件 Mod」并启用全部 ${OfficialModulesCatalog.ALL.size} 项官方模组！"
                            } else {
                                "已一键安装并启用全部 ${OfficialModulesCatalog.ALL.size} 项官方模组！"
                            }
                        )
                    } else {
                        toast(MiniJson.stringField(parsed, "error").ifEmpty { "一键安装未完成" })
                    }
                }
            } catch (e: Exception) {
                activity.runOnUiThread {
                    batchModsBusy = false
                    runtimeProgress = RuntimeProgressState()
                    toast("一键安装失败：${e.message}")
                }
            }
        }
    }

    fun uninstallAllOfficialModules() {
        if (busy || batchModsBusy) return
        if (!isPrivilegeReady()) {
            showConnectSheet = true
            toast("请先连接无线调试或 Shizuku。")
            return
        }
        val pkg = selectedPackageName
        batchModsBusy = true
        worker.execute {
            try {
                val csv = OfficialModulesCatalog.allIdsCsv()
                val respJson = if (useShizuku) {
                    remoteBinder!!.setOfficialModules(pkg, csv, false, true)
                } else {
                    requireLocalAdb().setOfficialModules(pkg, csv, false, true)
                }
                val parsed = MiniJson.parseObject(respJson)
                activity.runOnUiThread {
                    batchModsBusy = false
                    if (disposed) return@runOnUiThread
                    if (parsed["ok"] == true) {
                        applyOfficialModulesMap(parsed["officialModules"])
                        activeModuleCount = MiniJson.longField(parsed, "activeModuleCount", 0L).toInt()
                        toast("已卸载所有 ${OfficialModulesCatalog.ALL.size} 项星枢官方功能模组；如需还原纯净原版可点击上方卸载核心插件。")
                    } else {
                        toast(MiniJson.stringField(parsed, "error").ifEmpty { "卸载未完成" })
                    }
                }
            } catch (e: Exception) {
                activity.runOnUiThread {
                    batchModsBusy = false
                    toast("卸载失败：${e.message}")
                }
            }
        }
    }

    fun removeInstalledMod(entry: InstalledModEntry) {
        if (busy || modTaskBusy) return
        if (!isPrivilegeReady()) {
            showConnectSheet = true
            toast("请先连接无线调试或 Shizuku。")
            return
        }
        val pkg = selectedPackageName
        modTaskBusy = true
        worker.execute {
            try {
                val respJson = if (useShizuku) {
                    remoteBinder!!.removeModPack(pkg, entry.id)
                } else {
                    requireLocalAdb().removeModPack(pkg, entry.id)
                }
                val parsed = MiniJson.parseObject(respJson)
                val listJson = if (useShizuku) remoteBinder!!.listInstalledMods(pkg) else requireLocalAdb().listInstalledMods(pkg)
                activity.runOnUiThread {
                    modTaskBusy = false
                    if (disposed) return@runOnUiThread
                    applyListedMods(listJson)
                    if (parsed["ok"] == true) {
                        toast("已卸载 Mod：${entry.name.ifEmpty { entry.id }}")
                    } else {
                        toast(MiniJson.stringField(parsed, "error").ifEmpty { "卸载 Mod 失败" })
                    }
                }
            } catch (e: Exception) {
                activity.runOnUiThread {
                    modTaskBusy = false
                    toast("卸载失败：${e.message}")
                }
            }
        }
    }

    fun requestImportLocalArchive() {
        if (!isPrivilegeReady()) {
            showConnectSheet = true
            toast("导入本地 Mod 包前，请先连接无线调试或 Shizuku。")
            return
        }
        onPickLocalArchiveRequest?.invoke()
    }

    fun installLocalArchiveUri(uri: Uri) {
        if (!isPrivilegeReady()) {
            showConnectSheet = true
            return
        }
        if (modTaskBusy) {
            toast("已有 Mod 操作正在执行，请稍候。")
            return
        }
        modTaskBusy = true
        val pkg = selectedPackageName
        workshopWorker.execute {
            var tempFile: File? = null
            try {
                val displayName = resolveDisplayName(uri) ?: "local-mod.zip"
                val cacheDir = PayloadDownloadManager.cacheDir(appContext).apply { mkdirs() }
                tempFile = File.createTempFile("import-mod-", ".zip", cacheDir)
                val digest = MessageDigest.getInstance("SHA-256")
                var bytes = 0L
                appContext.contentResolver.openInputStream(uri).use { input ->
                    if (input == null) throw IOException("无法读取选中的文件")
                    FileOutputStream(tempFile).use { output ->
                        val buf = ByteArray(65536)
                        while (true) {
                            val n = input.read(buf)
                            if (n == -1) break
                            bytes += n
                            if (bytes > PayloadDownloadManager.MAX_PAYLOAD_BYTES) {
                                throw IOException("导入文件超过 1GB 上限")
                            }
                            digest.update(buf, 0, n)
                            output.write(buf, 0, n)
                        }
                        output.flush()
                    }
                }
                val sha = PayloadDownloadManager.hex(digest.digest())
                val cleanName = displayName.substringBeforeLast('.').ifBlank { "本地模组包" }
                val metaJson = MiniJson.stringify(
                    mapOf(
                        "id" to "local.${sha.take(12)}",
                        "name" to cleanName,
                        "version" to "1.0.0",
                        "sha256" to sha,
                        "installKind" to if (displayName.endsWith(".xspkg", true)) "xspkg" else "",
                    )
                )
                val respJson = if (useShizuku) {
                    ParcelFileDescriptor.open(tempFile, ParcelFileDescriptor.MODE_READ_ONLY).use { pfd ->
                        remoteBinder!!.installModPack(pkg, metaJson, pfd)
                    }
                } else {
                    requireLocalAdb().installModPack(pkg, metaJson, tempFile)
                }
                val parsed = MiniJson.parseObject(respJson)
                val listJson = if (useShizuku) remoteBinder!!.listInstalledMods(pkg) else requireLocalAdb().listInstalledMods(pkg)
                activity.runOnUiThread {
                    modTaskBusy = false
                    if (disposed) return@runOnUiThread
                    applyListedMods(listJson)
                    if (parsed["ok"] == true) {
                        val fileCount = MiniJson.longField(parsed, "fileCount", 0L)
                        toast("本地 Mod 导入成功：$cleanName（写入 $fileCount 个文件）")
                    } else {
                        toast(MiniJson.stringField(parsed, "error").ifEmpty { "导入失败" })
                    }
                }
            } catch (e: Exception) {
                activity.runOnUiThread {
                    modTaskBusy = false
                    toast("导入本地 Mod 失败：${e.message}")
                }
            } finally {
                tempFile?.delete()
            }
        }
    }

    // ---- Workshop & Lightweight Thumbnail Cache ----

    fun refreshWorkshopAsync() {
        if (workshopLoading) return
        workshopLoading = true
        workshopError = ""
        workshopWorker.execute {
            try {
                val items = AndroidWorkshopClient.fetchAndroidMods()
                activity.runOnUiThread {
                    if (disposed) return@runOnUiThread
                    workshopLoading = false
                    workshopMods.clear()
                    workshopMods.addAll(items)
                }
            } catch (e: Exception) {
                activity.runOnUiThread {
                    if (disposed) return@runOnUiThread
                    workshopLoading = false
                    workshopError = e.message ?: "无法连接工坊"
                }
            }
        }
    }

    fun requestWorkshopThumbnail(url: String) {
        if (url.isBlank()) return
        val cached = thumbCache.get(url)
        if (cached != null) {
            if (!thumbnails.containsKey(url)) thumbnails[url] = cached
            return
        }
        synchronized(thumbPending) {
            if (!thumbPending.add(url)) return
        }
        thumbWorker.execute {
            try {
                val safeUrl = PayloadDownloadManager.validateOfficialUrl(url)
                val conn = (safeUrl.openConnection() as HttpsURLConnection).apply {
                    instanceFollowRedirects = false
                    connectTimeout = 8000
                    readTimeout = 10000
                    requestMethod = "GET"
                }
                try {
                    if (conn.responseCode != 200) return@execute
                    val raw = conn.inputStream.use { input ->
                        val out = ByteArrayOutputStream()
                        val buf = ByteArray(8192)
                        var total = 0
                        while (true) {
                            val n = input.read(buf)
                            if (n == -1) break
                            total += n
                            if (total > 2 * 1024 * 1024) return@execute
                            out.write(buf, 0, n)
                        }
                        out.toByteArray()
                    }
                    val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(raw, 0, raw.size, opts)
                    val maxDim = maxOf(opts.outWidth, opts.outHeight).coerceAtLeast(1)
                    val sample = if (maxDim > 384) Integer.highestOneBit(maxDim / 192).coerceAtLeast(2) else 1
                    val decodeOpts = BitmapFactory.Options().apply {
                        inSampleSize = sample
                        inPreferredConfig = Bitmap.Config.RGB_565
                    }
                    val bmp = BitmapFactory.decodeByteArray(raw, 0, raw.size, decodeOpts) ?: return@execute
                    val img = bmp.asImageBitmap()
                    thumbCache.put(url, img)
                    activity.runOnUiThread {
                        if (!disposed) thumbnails[url] = img
                    }
                } finally {
                    conn.disconnect()
                }
            } catch (_: Exception) {
            } finally {
                synchronized(thumbPending) { thumbPending.remove(url) }
            }
        }
    }

    fun downloadAndInstallWorkshopMod(mod: AndroidWorkshopClient.WorkshopMod) {
        if (modTaskBusy) {
            toast("已有 Mod 下载安装任务正在进行中。")
            return
        }
        modTaskBusy = true
        val cacheDir = PayloadDownloadManager.cacheDir(appContext)
        val pkg = selectedPackageName
        modProgress = ModProgressState(mod.id, 0L, mod.sizeBytes, 0L, "正在准备下载 ${mod.name}…")

        workshopWorker.execute {
            try {
                val zipFile = PayloadDownloadManager.ensureDownloaded(
                    cacheDir,
                    mod.downloadUrl,
                    mod.sha256,
                    mod.sizeBytes,
                    mod.name,
                ) { received, total, speed, stage ->
                    activity.runOnUiThread {
                        modProgress = ModProgressState(mod.id, received, total, speed, stage)
                    }
                }

                if (!isPrivilegeReady()) {
                    activity.runOnUiThread {
                        modTaskBusy = false
                        modProgress = ModProgressState()
                        refreshCacheBytes()
                        toast("已下载并校验「${mod.name}」。连接无线调试或 Shizuku 后点击即可装入游戏。")
                    }
                    return@execute
                }

                activity.runOnUiThread {
                    modProgress = ModProgressState(
                        mod.id, mod.sizeBytes, mod.sizeBytes, 0L,
                        if (mod.isXspkgModule()) "正在写入并启用官方模块…" else "正在解压写入游戏 modimg/…",
                    )
                }

                val metaJson = MiniJson.stringify(
                    mapOf(
                        "id" to mod.id,
                        "name" to mod.name,
                        "version" to mod.version,
                        "sha256" to mod.sha256,
                        "installKind" to mod.installKind,
                    )
                )

                val respJson = if (useShizuku) {
                    ParcelFileDescriptor.open(zipFile, ParcelFileDescriptor.MODE_READ_ONLY).use { pfd ->
                        remoteBinder!!.installModPack(pkg, metaJson, pfd)
                    }
                } else {
                    requireLocalAdb().installModPack(pkg, metaJson, zipFile)
                }

                val parsed = MiniJson.parseObject(respJson)
                val listJson = if (useShizuku) remoteBinder!!.listInstalledMods(pkg) else requireLocalAdb().listInstalledMods(pkg)
                activity.runOnUiThread {
                    modTaskBusy = false
                    modProgress = ModProgressState()
                    refreshCacheBytes()
                    if (disposed) return@runOnUiThread
                    applyListedMods(listJson)
                    if (parsed["ok"] == true) {
                        val fileCount = MiniJson.longField(parsed, "fileCount", 0L)
                        toast("安装成功：${mod.name}（共写入 $fileCount 项）")
                    } else {
                        toast("安装未完成：${MiniJson.stringField(parsed, "error")}")
                    }
                }
            } catch (e: Exception) {
                activity.runOnUiThread {
                    modTaskBusy = false
                    modProgress = ModProgressState()
                    toast("安装「${mod.name}」失败：${e.message}")
                }
            }
        }
    }

    // ---- Appearance / Wallpaper Customization ----

    fun selectThemePreset(id: String) {
        themeId = id
        prefs.edit().putString("themeId", id).apply()
    }

    fun applyCustomHexColor(rawHex: String) {
        val norm = ThemePalette.normalizeHex(rawHex)
        customThemeHex = norm
        themeId = "custom"
        prefs.edit().putString("themeId", "custom").putString("customThemeHex", norm).apply()
        toast("已切换自定义主题色：$norm")
    }

    fun selectBrightnessMode(mode: ThemeBrightnessMode) {
        brightnessMode = mode
        prefs.edit()
            .putString("brightnessMode", mode.prefValue)
            .putBoolean("customThemeDark", mode == ThemeBrightnessMode.DARK)
            .apply()
    }

    fun updateWallpaperAlpha(alpha: Float) {
        val clamped = alpha.coerceIn(0.08f, 0.72f)
        wallpaperAlpha = clamped
        prefs.edit().putFloat("wallpaperAlpha", clamped).apply()
    }

    fun requestPickWallpaper() {
        onPickWallpaperRequest?.invoke()
    }

    fun importWallpaperUri(uri: Uri) {
        worker.execute {
            try {
                val dir = File(appContext.filesDir, "wallpaper").apply { mkdirs() }
                val dest = File(dir, "custom_wallpaper.bin")
                val tmp = File(dir, "custom_wallpaper.tmp")
                appContext.contentResolver.openInputStream(uri).use { input ->
                    if (input == null) throw IOException("无法读取所选图片")
                    FileOutputStream(tmp).use { output ->
                        val buf = ByteArray(32768)
                        var total = 0
                        while (true) {
                            val n = input.read(buf)
                            if (n == -1) break
                            total += n
                            if (total > 24 * 1024 * 1024) throw IOException("壁纸图片大小超出 24 MB 上限")
                            output.write(buf, 0, n)
                        }
                        output.flush()
                    }
                }
                if (dest.exists()) dest.delete()
                if (!tmp.renameTo(dest)) {
                    FileInputStream(tmp).use { i -> FileOutputStream(dest).use { o -> i.copyTo(o) } }
                    tmp.delete()
                }
                val img = decodeBoundedBitmap(dest, 1920)
                    ?: throw IOException("无法解码该图片格式")
                activity.runOnUiThread {
                    if (!disposed) {
                        wallpaperBitmap = img
                        prefs.edit().putBoolean("wallpaperEnabled", true).apply()
                        toast("已设置自定义启动器壁纸。")
                    }
                }
            } catch (e: Exception) {
                activity.runOnUiThread { toast("设置壁纸失败：${e.message}") }
            }
        }
    }

    fun clearWallpaper() {
        wallpaperBitmap = null
        prefs.edit().putBoolean("wallpaperEnabled", false).apply()
        File(appContext.filesDir, "wallpaper/custom_wallpaper.bin").delete()
        toast("已恢复默认纯净背景。")
    }

    private fun loadSavedWallpaperAsync() {
        if (!prefs.getBoolean("wallpaperEnabled", false)) return
        val file = File(appContext.filesDir, "wallpaper/custom_wallpaper.bin")
        if (!file.isFile) return
        worker.execute {
            val img = decodeBoundedBitmap(file, 1920) ?: return@execute
            activity.runOnUiThread {
                if (!disposed) wallpaperBitmap = img
            }
        }
    }

    private fun decodeBoundedBitmap(file: File, maxSidePx: Int): ImageBitmap? {
        return try {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.absolutePath, bounds)
            val largest = maxOf(bounds.outWidth, bounds.outHeight).coerceAtLeast(1)
            var sample = 1
            while (largest / sample > maxSidePx) {
                sample *= 2
            }
            val opts = BitmapFactory.Options().apply {
                inSampleSize = sample
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }
            BitmapFactory.decodeFile(file.absolutePath, opts)?.asImageBitmap()
        } catch (_: Exception) {
            null
        }
    }

    // ---- Account & Token Auth ----

    fun handleIntent(intent: Intent?) {
        if (intent == null) return
        if (Intent.ACTION_VIEW != intent.action || intent.data == null) return
        val uri = intent.data!!
        if ("xingshu-installer" == uri.scheme && "sync-game" == uri.host) {
            val pkgParam = uri.getQueryParameter("pkg")
            if (pkgParam != null && GamePackageCatalog.isValidPackageName(pkgParam)) {
                selectChannel(pkgParam)
            }
            val uidParam = uri.getQueryParameter("uid")
            if (!uidParam.isNullOrBlank()) {
                toast("已从游戏内跳转（UID $uidParam），可完成账号云端同步。")
            }
            activeTab = NavTab.SETTINGS
            return
        }
        try {
            val handoff = AssistantLoginLink.parse(uri.toString(), intent.getStringExtra("handoff"))
            pendingQqHandoff = handoff
            pendingQqRequester = "正在读取 QQ 请求信息…"
            activeTab = NavTab.SETTINGS
            authWorker.execute {
                val requester = try {
                    MobileAuthHub.qqHandoffRequester(handoff)
                } catch (_: Exception) {
                    "QQ 快速登录请求"
                }
                activity.runOnUiThread {
                    if (!disposed) pendingQqRequester = requester
                }
            }
        } catch (_: Exception) {
        }
    }

    fun startWebLogin() {
        if (authBusy) return
        authBusy = true
        webPollCancelled = false
        authStatusText = "正在向星枢服务器申请官网登录页…"
        val devId = MobileAuthHub.getOrCreateDeviceId(prefs)
        authWorker.execute {
            try {
                val start = MobileAuthHub.startWebDeviceLogin(devId)
                MobileAuthHub.savePendingWebLogin(prefs, start, System.currentTimeMillis() + 5 * 60_000L)
                activity.runOnUiThread {
                    if (disposed) return@runOnUiThread
                    webLoginUrl = start.loginUrl
                    authStatusText = "已打开官方授权页面，请在浏览器中完成登录并回到本应用。"
                    openExternalBrowser(start.loginUrl)
                }
                pollWebLoginLoop(start.requestId, start.verifier)
            } catch (e: Exception) {
                activity.runOnUiThread {
                    authBusy = false
                    authStatusText = "发起登录失败：${e.message}"
                }
            }
        }
    }

    private fun resumePendingWebAuthIfNeeded() {
        if (authBusy) return
        val pending = MobileAuthHub.loadPendingWebLogin(prefs, System.currentTimeMillis()) ?: return
        authBusy = true
        webPollCancelled = false
        authStatusText = "正在恢复浏览器授权状态查询…"
        authWorker.execute {
            pollWebLoginLoop(pending.requestId, pending.verifier)
        }
    }

    private fun pollWebLoginLoop(requestId: String, verifier: String) {
        try {
            val deadline = SystemClock.elapsedRealtime() + 180_000L
            while (SystemClock.elapsedRealtime() < deadline && !disposed && !webPollCancelled) {
                val poll = try {
                    MobileAuthHub.pollDeviceLogin(requestId, verifier)
                } catch (_: IOException) {
                    Thread.sleep(1600)
                    continue
                }
                if ("succeeded" == poll.status && poll.account != null) {
                    MobileAuthHub.clearPendingWebLogin(prefs)
                    MobileAuthHub.saveSession(prefs, poll.account)
                    val sum = try { MobileAuthHub.fetchAccountSummary(poll.account.token) } catch (_: Exception) { "" }
                    activity.runOnUiThread {
                        if (disposed) return@runOnUiThread
                        authBusy = false
                        webLoginUrl = ""
                        boundSession = poll.account
                        cloudSummary = sum
                        authStatusText = "已登录星枢账号：${poll.account.nick}（UID ${poll.account.uid}）"
                    }
                    return
                }
                if ("failed" == poll.status || "expired" == poll.status || "superseded" == poll.status) {
                    MobileAuthHub.clearPendingWebLogin(prefs)
                    throw IOException(poll.error.ifEmpty { "登录未完成或已过期" })
                }
                Thread.sleep(1600)
            }
            activity.runOnUiThread {
                authBusy = false
                if (webPollCancelled) authStatusText = "已取消网页登录。"
            }
        } catch (e: Exception) {
            activity.runOnUiThread {
                authBusy = false
                authStatusText = "网页登录未完成：${e.message}"
            }
        }
    }

    fun cancelWebLogin() {
        webPollCancelled = true
        authBusy = false
        webLoginUrl = ""
        MobileAuthHub.clearPendingWebLogin(prefs)
        authStatusText = "已取消网页登录。"
    }

    fun refreshCloudAccountAsync() {
        val current = boundSession ?: return
        authWorker.execute {
            try {
                val sum = MobileAuthHub.fetchAccountSummary(current.token)
                activity.runOnUiThread {
                    if (!disposed) cloudSummary = sum
                }
            } catch (e: Exception) {
                if ("UNAUTHORIZED" == e.message) {
                    MobileAuthHub.clearSession(prefs)
                    activity.runOnUiThread {
                        if (!disposed) {
                            boundSession = null
                            cloudSummary = ""
                            authStatusText = "星枢登录状态已过期，请重新登录。"
                        }
                    }
                }
            }
        }
    }

    fun scanChannelTokens() {
        if (authBusy) return
        if (!isPrivilegeReady()) {
            showConnectSheet = true
            toast("读取渠道登录日志需要先连接无线调试或 Shizuku。")
            return
        }
        authBusy = true
        authStatusText = "正在扫描手机游戏渠道登录票据…"
        authWorker.execute {
            try {
                val raw = if (useShizuku) remoteBinder!!.readChannelLogcat() else requireLocalAdb().readChannelLogcat()
                val tokens = BnSdkTokenExtractor.extractFromLogcat(raw, BnSdkTokenExtractor.appIdForPackage(selectedPackageName))
                activity.runOnUiThread {
                    authBusy = false
                    detectedTokens.clear()
                    detectedTokens.addAll(tokens)
                    selectedTokenIndex = 0
                    authStatusText = if (tokens.isEmpty()) {
                        "暂未发现有效的 BN_DEBUG 登录票据；请先启动渠道游戏登录进大厅一次后再扫描。"
                    } else {
                        "已发现 ${tokens.size} 条渠道票据，可选中后登录星枢或绑定 QQ。"
                    }
                }
            } catch (e: Exception) {
                activity.runOnUiThread {
                    authBusy = false
                    authStatusText = "扫描票据失败：${e.message}"
                }
            }
        }
    }

    fun startChannelHubAuth() {
        val tok = detectedTokens.getOrNull(selectedTokenIndex) ?: return
        if (authBusy) return
        authBusy = true
        webPollCancelled = false
        authStatusText = "正在通过「${tok.label}」票据登录星枢…"
        val devId = MobileAuthHub.getOrCreateDeviceId(prefs)
        authWorker.execute {
            try {
                val start = MobileAuthHub.startChannelHubLogin(devId, tok)
                pollWebLoginLoop(start.requestId, start.verifier)
            } catch (e: Exception) {
                activity.runOnUiThread {
                    authBusy = false
                    authStatusText = "渠道授权失败：${e.message}"
                }
            }
        }
    }

    fun bindQqWithCurrentSession() {
        val acct = boundSession ?: return
        val handoff = pendingQqHandoff
        if (authBusy || handoff.isBlank()) return
        authBusy = true
        authWorker.execute {
            try {
                val updated = MobileAuthHub.bindCurrentSessionToQq(handoff, acct)
                MobileAuthHub.saveSession(prefs, updated)
                activity.runOnUiThread {
                    authBusy = false
                    boundSession = updated
                    pendingQqHandoff = ""
                    pendingQqRequester = ""
                    authStatusText = "已将账号 ${updated.nick}（UID ${updated.uid}）绑定至 QQ。"
                    toast("QQ 绑定成功！")
                }
            } catch (e: Exception) {
                activity.runOnUiThread {
                    authBusy = false
                    toast("绑定未完成：${e.message}")
                }
            }
        }
    }

    fun dismissQqHandoff() {
        pendingQqHandoff = ""
        pendingQqRequester = ""
    }

    fun bindQqLinkWithSelectedToken() {
        val tok = detectedTokens.getOrNull(selectedTokenIndex) ?: return
        val link = qqLinkInput.trim()
        if (authBusy || link.isBlank()) return
        try {
            BnSdkTokenExtractor.parseLoginLink(link)
        } catch (e: Exception) {
            authStatusText = e.message ?: "QQ 登录链接格式无效"
            return
        }
        authBusy = true
        authStatusText = "正在验证 ${tok.label} 票据并绑定 QQ…"
        authWorker.execute {
            try {
                val res = MobileAuthHub.completeQqLinkWithChannelToken(link, tok)
                activity.runOnUiThread {
                    authBusy = false
                    authStatusText = "QQ 绑定成功：${res.nick}（UID ${res.uid}）"
                    toast("QQ Bot 绑定成功！")
                }
            } catch (e: Exception) {
                activity.runOnUiThread {
                    authBusy = false
                    authStatusText = "QQ 绑定失败：${e.message}"
                }
            }
        }
    }

    fun logoutAccount() {
        MobileAuthHub.clearSession(prefs)
        boundSession = null
        cloudSummary = ""
        authStatusText = "已退出星枢账号。"
    }

    // ---- Self-Update & Cache / Diagnostics ----

    fun setPreviewUpdatesEnabled(enabled: Boolean) {
        previewUpdates = enabled
        prefs.edit().putBoolean("previewUpdates", enabled).apply()
    }

    fun checkAssistantUpdate(silent: Boolean) {
        if (!updateTaskActive.compareAndSet(false, true)) return
        if (!silent) updateStatusText = "正在检查官方最新发行版…"
        updateWorker.execute {
            try {
                val found = ReleaseUpdates.check(
                    previewUpdates,
                    { appContext.assets.open("update-public-cert.txt") },
                    { stage -> if (!silent) activity.runOnUiThread { updateStatusText = stage } },
                )
                activity.runOnUiThread {
                    updateTaskActive.set(false)
                    if (disposed) return@runOnUiThread
                    if (found != null && found.code() > BuildConfig.VERSION_CODE) {
                        availableUpdate = found
                        updateStatusText = "发现新版 v${found.version()}（当前 ${BuildConfig.VERSION_NAME}）"
                        showUpdateModal = true
                    } else if (!silent) {
                        updateStatusText = "当前已是最新版本 v${BuildConfig.VERSION_NAME}"
                        toast("当前已是最新版本")
                    }
                }
            } catch (e: Exception) {
                activity.runOnUiThread {
                    updateTaskActive.set(false)
                    if (!silent && !disposed) {
                        updateStatusText = ReleaseUpdates.failureMessage(e)
                    }
                }
            }
        }
    }

    fun downloadAvailableUpdate() {
        val upd = availableUpdate ?: return
        if (!updateTaskActive.compareAndSet(false, true)) return
        updateDownloading = true
        updateVerifying = false
        updateProgressPct = 0
        updateWorker.execute {
            try {
                val apk = ReleaseUpdates.download(
                    upd,
                    appContext.cacheDir,
                    object : ReleaseUpdates.DownloadListener {
                        override fun progress(read: Long, total: Long) {
                            val pct = if (total > 0L) ((read * 100L) / total).toInt().coerceIn(0, 100) else 0
                            activity.runOnUiThread {
                                updateProgressPct = pct
                                updateStatusText = "正在下载新版 APK… $pct%"
                            }
                        }

                        override fun verifying() {
                            activity.runOnUiThread {
                                updateVerifying = true
                                updateStatusText = "正在校验 APK SHA-256 与签名…"
                            }
                        }
                    },
                )
                verifyDownloadedApk(apk, upd)
                activity.runOnUiThread {
                    updateTaskActive.set(false)
                    updateDownloading = false
                    updateVerifying = false
                    updateProgressPct = 100
                    showUpdateModal = false
                    requestInstallPendingUpdateApk()
                }
            } catch (e: Exception) {
                activity.runOnUiThread {
                    updateTaskActive.set(false)
                    updateDownloading = false
                    updateVerifying = false
                    updateStatusText = "更新失败：${ReleaseUpdates.failureMessage(e)}"
                }
            }
        }
    }

    private fun verifyDownloadedApk(apk: File, update: ReleaseUpdates.Update) {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(apk).use { input ->
            val buf = ByteArray(65536)
            while (true) {
                val n = input.read(buf)
                if (n == -1) break
                digest.update(buf, 0, n)
            }
        }
        val expected = update.manifest.getJSONObject("android").getString("sha256")
        if (ReleaseUpdates.hex(digest.digest()) != expected) {
            throw IOException("APK 文件哈希已变化")
        }
    }

    private fun requestInstallPendingUpdateApk() {
        val apk = File(appContext.cacheDir, "update.apk")
        val upd = availableUpdate ?: return
        if (!apk.isFile) return
        try {
            verifyDownloadedApk(apk, upd)
            if (Build.VERSION.SDK_INT >= 26 && !appContext.packageManager.canRequestPackageInstalls()) {
                prefs.edit().putBoolean("waitingInstallPermission", true).apply()
                activity.startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:${appContext.packageName}"),
                    )
                )
                toast("请先在系统设置中授予安装应用权限。")
                return
            }
            val uri = Uri.parse("content://${BuildConfig.APPLICATION_ID}.update/update.apk")
            activity.startActivity(
                Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (e: Exception) {
            toast("未能拉起系统安装界面：${e.message}")
        }
    }

    fun refreshCacheBytes() {
        cacheBytes = PayloadDownloadManager.getCacheTotalBytes(PayloadDownloadManager.cacheDir(appContext))
    }

    fun clearDownloadCache() {
        worker.execute {
            val freed = PayloadDownloadManager.clearCache(PayloadDownloadManager.cacheDir(appContext))
            activity.runOnUiThread {
                refreshCacheBytes()
                toast("已清理缓存 ${PayloadDownloadManager.formatBytes(freed)}。")
            }
        }
    }

    fun exportDiagnosticLog() {
        val ts = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.CHINA).format(Date())
        onExportLogRequest?.invoke("XingShu-Android-$ts.log")
    }

    fun writeDiagnosticLogToUri(uri: Uri) {
        try {
            appContext.contentResolver.openOutputStream(uri)?.use { out ->
                out.write(buildDiagnosticReport().toByteArray(Charsets.UTF_8))
                out.flush()
            }
            toast("已保存诊断报告文件。")
        } catch (e: Exception) {
            toast("保存诊断日志失败：${e.message}")
        }
    }

    fun copyDiagnosticLogToClipboard() {
        val cm = appContext.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        cm?.setPrimaryClip(ClipData.newPlainText("XingShu Diagnostics", buildDiagnosticReport()))
        toast("已复制诊断信息到剪贴板。")
    }

    fun buildDiagnosticReport(): String = buildString {
        appendLine("=== 星枢安卓启动器 · 诊断报告 ===")
        appendLine("版本：${BuildConfig.VERSION_NAME} (code=${BuildConfig.VERSION_CODE})")
        appendLine("官方插件目标组件：${coreSpec.runtimeVersion}（适配游戏 ${coreSpec.gameVersion} · 来源 ${coreSpec.source}）")
        appendLine("设备：${Build.MODEL} / Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        appendLine("选中渠道包名：$selectedPackageName")
        appendLine("已发现渠道数：${channels.size}")
        appendLine("授权通道：${if (useShizuku) "Shizuku(${remoteBinder != null})" else "LocalADB($adbConnected)"}")
        appendLine("已开启官方模组数：${officialModuleStates.count { it.value == "enabled" }} / ${OfficialModulesCatalog.ALL.size}")
        if (lastResultText.isNotBlank()) {
            appendLine()
            appendLine("--- 最近检查/执行结果 ---")
            appendLine(lastResultText)
        }
        appendLine()
        appendLine("--- 运行日志 ---")
        logs.forEach { appendLine(it) }
    }

    fun openExternalBrowser(url: String) {
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (_: Exception) {
            toast("未能打开系统浏览器")
        }
    }

    private fun resolveDisplayName(uri: Uri): String? {
        return try {
            appContext.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        } catch (_: Exception) {
            null
        }
    }

    // ---- JSON parsers ----

    private fun applyScannedPackages(scanJson: String) {
        try {
            val root = MiniJson.parseObject(scanJson)
            val err = MiniJson.stringField(root, "error")
            if (err.isNotEmpty()) {
                appendLog("渠道扫描异常：$err")
                return
            }
            val rawList = root["packages"] as? List<*> ?: return
            val parsed = mutableListOf<ChannelEntry>()
            for (obj in rawList) {
                val map = obj as? Map<*, *> ?: continue
                @Suppress("UNCHECKED_CAST")
                val m = map as Map<String, Any?>
                val pkg = MiniJson.stringField(m, "packageName")
                if (!GamePackageCatalog.isValidPackageName(pkg)) continue
                parsed.add(
                    ChannelEntry(
                        packageName = pkg,
                        label = MiniJson.stringField(m, "label").ifEmpty { GamePackageCatalog.classifyPackage(pkg).label },
                        platform = MiniJson.stringField(m, "platform"),
                        versionName = MiniJson.stringField(m, "versionName"),
                        hasCatalog = MiniJson.boolField(m, "hasCatalog", false),
                        running = MiniJson.boolField(m, "running", false),
                        installState = MiniJson.stringField(m, "installState"),
                        resolvedRel = MiniJson.stringField(m, "resolvedRel"),
                    )
                )
            }
            if (parsed.isNotEmpty()) {
                channels.clear()
                channels.addAll(parsed)
                if (parsed.none { it.packageName == selectedPackageName }) {
                    selectedPackageName = parsed.first().packageName
                }
            }
        } catch (_: Exception) {
        }
    }

    private fun applyListedMods(listJson: String) {
        try {
            val root = MiniJson.parseObject(listJson)
            if (root["ok"] != true) return
            applyOfficialModulesMap(root["officialModules"])
            activeModuleCount = MiniJson.longField(root, "activeModuleCount", 0L).toInt()
            totalModPngCount = MiniJson.longField(root, "totalPngCount", 0L).toInt()

            val rawMods = root["mods"] as? List<*>
            val parsed = mutableListOf<InstalledModEntry>()
            if (rawMods != null) {
                for (obj in rawMods) {
                    val map = obj as? Map<*, *> ?: continue
                    @Suppress("UNCHECKED_CAST")
                    val m = map as Map<String, Any?>
                    val id = MiniJson.stringField(m, "id")
                    if (id.isEmpty()) continue
                    parsed.add(
                        InstalledModEntry(
                            id = id,
                            name = MiniJson.stringField(m, "name"),
                            version = MiniJson.stringField(m, "version"),
                            sha256 = MiniJson.stringField(m, "sha256"),
                            installKind = MiniJson.stringField(m, "installKind"),
                            declaredCount = MiniJson.longField(m, "declaredCount", 0L).toInt(),
                            presentCount = MiniJson.longField(m, "presentCount", 0L).toInt(),
                        )
                    )
                }
            }
            installedMods.clear()
            installedMods.addAll(parsed)
        } catch (_: Exception) {
        }
    }

    private fun applyOfficialModulesMap(raw: Any?) {
        officialModuleStates.clear()
        val map = raw as? Map<*, *> ?: return
        for ((k, v) in map) {
            val id = k?.toString()?.trim()?.lowercase(Locale.ROOT) ?: continue
            val state = v?.toString()?.trim()?.lowercase(Locale.ROOT) ?: continue
            if (OfficialModulesCatalog.isSafeId(id)) {
                officialModuleStates[id] = state
            }
        }
    }
}
