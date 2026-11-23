package app.xingshu.installer

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoFixHigh
import androidx.compose.material.icons.rounded.Clear
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun WorkshopScreen(controller: AppController) {
    val context = LocalContext.current
    val cacheDir = remember(context) { PayloadDownloadManager.cacheDir(context) }
    var searchQuery by remember { mutableStateOf("") }
    var kindFilter by remember { mutableStateOf("all") }

    LaunchedEffect(Unit) {
        controller.refreshWorkshopAsync(userInitiated = false)
    }

    val allMods = controller.workshopMods.toList()
    val installableCount = remember(allMods) { allMods.count { it.androidInstallable } }
    val communityCount = remember(allMods) { allMods.count { !it.isXspkgModule() } }
    val xspkgCount = remember(allMods) { allMods.count { it.isXspkgModule() } }

    val filteredMods = remember(allMods, searchQuery, kindFilter) {
        val q = searchQuery.trim().lowercase()
        allMods.filter { mod ->
            val kindOk = when (kindFilter) {
                "android" -> mod.androidInstallable
                "community" -> !mod.isXspkgModule()
                "xspkg" -> mod.isXspkgModule()
                else -> true
            }
            val queryOk = q.isEmpty() ||
                mod.name.lowercase().contains(q) ||
                mod.author.lowercase().contains(q) ||
                mod.description.lowercase().contains(q) ||
                mod.categoryLabel.lowercase().contains(q) ||
                mod.platformLabel.lowercase().contains(q)
            kindOk && queryOk
        }
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Spacer(modifier = Modifier.height(4.dp))
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                placeholder = { Text("搜索工坊 Mod 名称、作者、平台或说明…") },
                leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
                trailingIcon = {
                    if (searchQuery.isNotEmpty()) {
                        IconButton(onClick = { searchQuery = "" }) {
                            Icon(Icons.Rounded.Clear, contentDescription = "清空搜索")
                        }
                    }
                },
                shape = RoundedCornerShape(16.dp),
            )
        }

        item {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    FlowRow(
                        modifier = Modifier.weight(1f),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        FilterChip(
                            selected = kindFilter == "all",
                            onClick = { kindFilter = "all" },
                            label = { Text("全部 (${allMods.size})") },
                        )
                        FilterChip(
                            selected = kindFilter == "android",
                            onClick = { kindFilter = "android" },
                            label = { Text("手机可装 ($installableCount)") },
                        )
                        FilterChip(
                            selected = kindFilter == "community",
                            onClick = { kindFilter = "community" },
                            label = { Text("社区模组 ($communityCount)") },
                        )
                        FilterChip(
                            selected = kindFilter == "xspkg",
                            onClick = { kindFilter = "xspkg" },
                            label = { Text("官方优化 ($xspkgCount)") },
                        )
                    }
                    IconButton(
                        onClick = { controller.refreshWorkshopAsync(userInitiated = true) },
                        enabled = !controller.workshopLoading,
                    ) {
                        Icon(Icons.Rounded.Refresh, contentDescription = "刷新工坊")
                    }
                }

                if (controller.workshopLoading) {
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                }

                Text(
                    text = buildString {
                        append("实时工坊 · 共 ${allMods.size} 项（手机可直装 $installableCount 项）")
                        if (controller.workshopLastSyncTime.isNotEmpty()) {
                            append(" · 同步于 ${controller.workshopLastSyncTime}")
                        }
                        if (controller.workshopLoading) {
                            append(" · 同步中…")
                        }
                    },
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                if (controller.workshopError.isNotEmpty() && allMods.isNotEmpty()) {
                    Text(
                        text = "同步提示：${controller.workshopError}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }

        if (controller.workshopLoading && controller.workshopMods.isEmpty()) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 48.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        CircularProgressIndicator()
                        Text("正在实时同步星枢工坊目录…", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        } else if (controller.workshopError.isNotEmpty() && controller.workshopMods.isEmpty()) {
            item {
                OutlinedCard {
                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("工坊加载失败", style = MaterialTheme.typography.titleMedium)
                        Text(controller.workshopError, style = MaterialTheme.typography.bodySmall)
                        FilledTonalButton(onClick = { controller.refreshWorkshopAsync(userInitiated = true) }) {
                            Text("重新加载")
                        }
                    }
                }
            }
        } else if (filteredMods.isEmpty()) {
            item {
                OutlinedCard {
                    Text(
                        text = "没有找到匹配的工坊模组条目。",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(18.dp),
                    )
                }
            }
        } else {
            items(filteredMods, key = { "${it.id}_${it.versionId}" }) { mod ->
                val isXspkg = mod.isXspkgModule()
                val installedEntry = controller.installedMods.firstOrNull { it.id == mod.id }
                val sameInstalled = installedEntry != null && installedEntry.sha256.equals(mod.sha256, ignoreCase = true)
                val cached = PayloadDownloadManager.hasCachedFile(cacheDir, mod.sha256, mod.sizeBytes)
                val activeProg = controller.modProgress.takeIf { it.modId == mod.id }

                if (mod.previewUrl.isNotEmpty()) {
                    LaunchedEffect(mod.previewUrl) {
                        controller.requestWorkshopThumbnail(mod.previewUrl)
                    }
                }
                val thumbBitmap = if (mod.previewUrl.isNotEmpty()) controller.thumbnails[mod.previewUrl] else null

                OutlinedCard(
                    onClick = { controller.workshopDetailMod = mod },
                    colors = CardDefaults.outlinedCardColors(
                        containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
                    ),
                    shape = RoundedCornerShape(18.dp),
                ) {
                    Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Surface(
                                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                                shape = RoundedCornerShape(14.dp),
                                modifier = Modifier
                                    .size(56.dp)
                                    .clip(RoundedCornerShape(14.dp)),
                            ) {
                                if (thumbBitmap != null) {
                                    Image(
                                        bitmap = thumbBitmap,
                                        contentDescription = mod.name,
                                        contentScale = ContentScale.Crop,
                                        modifier = Modifier.fillMaxSize(),
                                    )
                                } else {
                                    Box(contentAlignment = Alignment.Center) {
                                        Icon(
                                            if (isXspkg) Icons.Rounded.AutoFixHigh else Icons.Rounded.Image,
                                            contentDescription = null,
                                            tint = MaterialTheme.colorScheme.primary,
                                        )
                                    }
                                }
                            }

                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = mod.name,
                                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    text = buildString {
                                        append("${mod.author} · v${mod.version}")
                                        if (mod.sizeBytes > 0L) {
                                            append(" · ${PayloadDownloadManager.formatBytes(mod.sizeBytes)}")
                                        }
                                        append(" · ${mod.downloads} 下载")
                                    },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                FlowRow(
                                    modifier = Modifier.padding(top = 4.dp),
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                    verticalArrangement = Arrangement.spacedBy(4.dp),
                                ) {
                                    BadgeChip(mod.categoryLabel.ifEmpty { if (isXspkg) "官方优化" else "社区模组" })
                                    BadgeChip(
                                        if (mod.androidInstallable) mod.platformLabel.ifEmpty { "手机端 (PE)" }
                                        else "仅 PC 端"
                                    )
                                    if (mod.androidInstallable) {
                                        if (sameInstalled) BadgeChip("已安装")
                                        else if (cached) BadgeChip("已缓存")
                                    }
                                }
                            }
                        }

                        if (mod.description.isNotBlank()) {
                            Text(
                                text = mod.description,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }

                        if (activeProg != null) {
                            val frac = if (activeProg.total > 0L) (activeProg.received.toFloat() / activeProg.total.toFloat()).coerceIn(0f, 1f) else 0f
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(
                                    text = "${activeProg.stage} ${(frac * 100).toInt()}%",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                                if (activeProg.total > 0L) {
                                    LinearProgressIndicator(progress = { frac }, modifier = Modifier.fillMaxWidth())
                                } else {
                                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                                }
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.End,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            TextButton(onClick = { controller.workshopDetailMod = mod }) {
                                Text("详情")
                            }
                            Spacer(modifier = Modifier.width(6.dp))
                            if (mod.androidInstallable) {
                                FilledTonalButton(
                                    onClick = { controller.pendingWorkshopPromptMod = mod },
                                    enabled = !controller.modTaskBusy && !controller.busy,
                                ) {
                                    Icon(Icons.Rounded.Download, contentDescription = null, modifier = Modifier.size(16.dp))
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text(if (sameInstalled) "重装" else if (cached) "立即安装" else "下载并安装")
                                }
                            } else {
                                OutlinedButton(
                                    onClick = { controller.openExternalBrowser(mod.webDetailUrl()) },
                                ) {
                                    Icon(Icons.Rounded.OpenInNew, contentDescription = null, modifier = Modifier.size(16.dp))
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("网页查看")
                                }
                            }
                        }
                    }
                }
            }
        }

        item { Spacer(modifier = Modifier.height(14.dp)) }
    }

    // Detail dialog
    val detailMod = controller.workshopDetailMod
    if (detailMod != null) {
        AlertDialog(
            onDismissRequest = { controller.workshopDetailMod = null },
            title = { Text(detailMod.name) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("作者：${detailMod.author} · 版本：v${detailMod.version} · ${detailMod.downloads} 次下载")
                    Text(
                        buildString {
                            append("适用：")
                            append(
                                if (detailMod.androidInstallable) detailMod.platformLabel.ifEmpty { "手机端 (PE)" }
                                else "仅 PC 端（请在电脑端星枢或网页工坊下载）"
                            )
                            if (detailMod.sizeBytes > 0L) {
                                append(" · 体积：${PayloadDownloadManager.formatBytes(detailMod.sizeBytes)}")
                            }
                        }
                    )
                    if (detailMod.targetInfo.isNotBlank()) {
                        Text("目标路径：${detailMod.targetInfo}", style = MaterialTheme.typography.bodySmall)
                    }
                    if (detailMod.description.isNotBlank()) {
                        Text(detailMod.description, style = MaterialTheme.typography.bodySmall)
                    }
                    if (detailMod.notes.isNotBlank()) {
                        Text("更新说明：${detailMod.notes}", style = MaterialTheme.typography.bodySmall)
                    }
                }
            },
            dismissButton = {
                TextButton(onClick = { controller.workshopDetailMod = null }) {
                    Text("关闭")
                }
            },
            confirmButton = {
                if (detailMod.androidInstallable) {
                    Button(
                        onClick = {
                            controller.workshopDetailMod = null
                            controller.pendingWorkshopPromptMod = detailMod
                        },
                        enabled = !controller.modTaskBusy && !controller.busy,
                    ) {
                        Text("下载并安装")
                    }
                } else {
                    Button(
                        onClick = {
                            val url = detailMod.webDetailUrl()
                            controller.workshopDetailMod = null
                            controller.openExternalBrowser(url)
                        },
                    ) {
                        Icon(Icons.Rounded.OpenInNew, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("网页查看")
                    }
                }
            },
        )
    }

    // Install confirmation dialog
    val promptMod = controller.pendingWorkshopPromptMod
    if (promptMod != null) {
        AlertDialog(
            onDismissRequest = { controller.pendingWorkshopPromptMod = null },
            title = { Text("确认安装「${promptMod.name}」") },
            text = {
                Text(
                    if (promptMod.isXspkgModule()) {
                        "将下载并校验 SHA-256 后写入目标渠道 xingshu/plugins/ 目录（需在「模组」页安装星枢官方插件 Mod 后生效）。"
                    } else {
                        "将下载并解压 PNG 贴图资源写入目标渠道 modimg/ 目录；可随时在「模组」页一键卸载。"
                    }
                )
            },
            dismissButton = {
                TextButton(onClick = { controller.pendingWorkshopPromptMod = null }) {
                    Text("取消")
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        controller.pendingWorkshopPromptMod = null
                        controller.downloadAndInstallWorkshopMod(promptMod)
                    },
                ) {
                    Text("确认安装")
                }
            },
        )
    }
}

@Composable
private fun BadgeChip(label: String) {
    Surface(
        color = MaterialTheme.colorScheme.secondaryContainer,
        shape = RoundedCornerShape(999.dp),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSecondaryContainer,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
        )
    }
}
