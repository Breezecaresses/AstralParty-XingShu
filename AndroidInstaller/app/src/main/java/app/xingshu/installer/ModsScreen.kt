package app.xingshu.installer

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Extension
import androidx.compose.material.icons.rounded.FileUpload
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Restore
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Usb
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ModsScreen(controller: AppController) {
    var selectedGroup by remember { mutableStateOf("全部") }
    val selected = controller.selectedChannel()
    val privReady = controller.isPrivilegeReady()
    val coreState = selected?.installState ?: "unverified"
    val enabledCount = controller.officialModuleStates.count { it.value == "enabled" }
    val hasAnyOfficial = controller.officialModuleStates.isNotEmpty()
    val visibleModules = remember(selectedGroup) {
        if (selectedGroup == "全部") OfficialModulesCatalog.ALL
        else OfficialModulesCatalog.ALL.filter { it.group == selectedGroup }
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Spacer(modifier = Modifier.height(4.dp))
        }

        // Authorization hint banner if disconnected
        if (!privReady) {
            item {
                OutlinedCard(
                    onClick = { controller.showConnectSheet = true },
                    colors = CardDefaults.outlinedCardColors(
                        containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.65f),
                    ),
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Icon(
                            Icons.Rounded.Usb,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onPrimaryContainer,
                        )
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "连接无线调试或 Shizuku 以写入游戏目录",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onPrimaryContainer,
                            )
                            Text(
                                text = "Android 11+ 系统隔离了游戏数据目录；点击立即配置授权。",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onPrimaryContainer,
                            )
                        }
                        TextButton(onClick = { controller.showConnectSheet = true }) {
                            Text("配置")
                        }
                    }
                }
            }
        }

        // Pinned Core Plugin Card: 星枢官方插件 Mod
        item {
            ElevatedCard(
                colors = CardDefaults.elevatedCardColors(
                    containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
                ),
                shape = MaterialTheme.shapes.large,
            ) {
                Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.weight(1f),
                        ) {
                            Icon(
                                Icons.Rounded.Shield,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                            )
                            Text(
                                text = "星枢官方插件 Mod（核心框架）",
                                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        AssistChip(
                            onClick = { controller.inspectSelectedAsync() },
                            label = {
                                Text(
                                    when (coreState) {
                                        "installed" -> "已安装"
                                        "upgrade" -> "有新版可更新"
                                        "conflict" -> "存在冲突"
                                        "vanilla" -> "未安装 · 纯净启动"
                                        else -> "未检测"
                                    }
                                )
                            },
                        )
                    }

                    Text(
                        text = "控制目标：${selected?.label ?: controller.selectedPackageName} · 运行版本 ${PayloadSpec.VERSION}\n仅当你需要使用下方 18 项官方功能模组或游戏内开房时安装此核心插件，可随时无损还原回官方原版。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    if (controller.runtimeProgress.active) {
                        val prog = controller.runtimeProgress
                        val frac = if (prog.total > 0L) (prog.received.toFloat() / prog.total.toFloat()).coerceIn(0f, 1f) else 0f
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                text = "${prog.stage} (${PayloadDownloadManager.formatBytes(prog.received)} / ${PayloadDownloadManager.formatBytes(prog.total)})",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                            if (prog.total > 0L) {
                                LinearProgressIndicator(progress = { frac }, modifier = Modifier.fillMaxWidth())
                            } else {
                                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                            }
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Button(
                            onClick = { controller.installOrRestoreCorePlugin(restore = false) },
                            enabled = !controller.busy && !controller.batchModsBusy,
                            modifier = Modifier.weight(1f),
                        ) {
                            Icon(Icons.Rounded.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                when (coreState) {
                                    "installed" -> "重新校验安装"
                                    "upgrade" -> "更新官方插件 Mod"
                                    else -> "安装官方插件 Mod"
                                }
                            )
                        }
                        OutlinedButton(
                            onClick = { controller.installOrRestoreCorePlugin(restore = true) },
                            enabled = !controller.busy && !controller.batchModsBusy,
                        ) {
                            Icon(Icons.Rounded.Restore, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("还原原版")
                        }
                    }
                }
            }
        }

        // Batch One-Click Card: 18 Official Modules
        item {
            OutlinedCard(
                colors = CardDefaults.outlinedCardColors(
                    containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
                ),
                shape = MaterialTheme.shapes.medium,
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "星枢官方功能模组（18 项独立模块）",
                                style = MaterialTheme.typography.titleMedium,
                            )
                            Text(
                                text = "当前已开启 $enabledCount / ${OfficialModulesCatalog.ALL.size} 项 · 支持一键安装或逐项自由开关",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        IconButtonBtn(onClick = { controller.refreshInstalledModsAsync() })
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        FilledTonalButton(
                            onClick = { controller.installAllOfficialModules(includeCore = true) },
                            enabled = !controller.busy && !controller.batchModsBusy,
                            modifier = Modifier.weight(1f),
                        ) {
                            Icon(Icons.Rounded.CheckCircle, contentDescription = null, modifier = Modifier.size(17.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("一键安装全部 (18 项)")
                        }
                        OutlinedButton(
                            onClick = { controller.uninstallAllOfficialModules() },
                            enabled = !controller.busy && !controller.batchModsBusy && hasAnyOfficial,
                        ) {
                            Icon(Icons.Rounded.DeleteOutline, contentDescription = null, modifier = Modifier.size(17.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("全部卸载")
                        }
                    }

                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        OfficialModulesCatalog.GROUPS.forEach { grp ->
                            FilterChip(
                                selected = selectedGroup == grp,
                                onClick = { selectedGroup = grp },
                                label = { Text(grp) },
                            )
                        }
                    }
                }
            }
        }

        // Individual 18 Official Modules Switches
        items(visibleModules, key = { it.id }) { mod ->
            val diskState = controller.officialModuleStates[mod.id] ?: "not_installed"
            val checked = diskState == "enabled"
            OutlinedCard(
                colors = CardDefaults.outlinedCardColors(
                    containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.90f),
                ),
                shape = RoundedCornerShape(16.dp),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Surface(
                        color = if (checked) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh,
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.size(40.dp),
                    ) {
                        Column(
                            modifier = Modifier.fillMaxSize(),
                            verticalArrangement = Arrangement.Center,
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Icon(
                                Icons.Rounded.Extension,
                                contentDescription = null,
                                tint = if (checked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Text(
                                text = mod.name,
                                style = MaterialTheme.typography.titleMedium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Surface(
                                color = MaterialTheme.colorScheme.surfaceContainerLow,
                                shape = RoundedCornerShape(999.dp),
                            ) {
                                Text(
                                    text = mod.group,
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                                )
                            }
                        }
                        Text(
                            text = mod.description,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(
                        checked = checked,
                        enabled = !controller.busy && !controller.batchModsBusy,
                        onCheckedChange = { enable -> controller.toggleOfficialModule(mod.id, enable) },
                    )
                }
            }
        }

        // Community & Local Installed Packs Header
        item {
            Spacer(modifier = Modifier.height(6.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "本地导入与社区 Mod 包",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        text = "当前 modimg 贴图 ${controller.totalModPngCount} 张 · 已安装外部包 ${controller.installedMods.size} 项",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                FilledTonalButton(
                    onClick = { controller.requestImportLocalArchive() },
                    enabled = !controller.modTaskBusy && !controller.busy,
                ) {
                    Icon(Icons.Rounded.FileUpload, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("导入本地包")
                }
            }
        }

        if (controller.installedMods.isEmpty()) {
            item {
                OutlinedCard(
                    colors = CardDefaults.outlinedCardColors(
                        containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.85f),
                    ),
                ) {
                    Text(
                        text = "暂无已安装的社区贴图包或本地导入 Mod；可从「工坊」下载或点击上方「导入本地包」选择 .zip / .xspkg 文件。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(16.dp),
                    )
                }
            }
        } else {
            items(controller.installedMods, key = { it.id }) { entry ->
                OutlinedCard(
                    colors = CardDefaults.outlinedCardColors(
                        containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.90f),
                    ),
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = entry.name.ifEmpty { entry.id },
                                style = MaterialTheme.typography.titleMedium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                text = "${if (entry.isXspkgModule()) "优化模块 (.xspkg)" else "贴图包 (modimg)"} · v${entry.version} · 文件 ${entry.presentCount}/${maxOf(1, entry.declaredCount)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        OutlinedButton(
                            onClick = { controller.removeInstalledMod(entry) },
                            enabled = !controller.modTaskBusy && !controller.busy,
                        ) {
                            Text("卸载")
                        }
                    }
                }
            }
        }

        item { Spacer(modifier = Modifier.height(14.dp)) }
    }
}

@Composable
private fun IconButtonBtn(onClick: () -> Unit) {
    androidx.compose.material3.IconButton(onClick = onClick) {
        Icon(Icons.Rounded.Refresh, contentDescription = "刷新列表")
    }
}
