package com.example.a2uidemo

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import org.json.JSONObject

data class DemoExample(
    val id: String,
    val title: String,
    val hint: String,
    val asset: String,
)

private val examples = listOf(
    DemoExample("login", "登录表单", "TextField · CheckBox · Button", "examples/login.json"),
    DemoExample("product", "商品卡片", "Card · Image · formatCurrency", "examples/product.json"),
    DemoExample("settings", "设置页", "Slider · Divider · 双按钮", "examples/settings.json"),
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            A2uiDemoTheme {
                DemoApp()
            }
        }
    }
}

@Composable
private fun A2uiDemoTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val colors = if (dark) {
        darkColorScheme(
            primary = Color(0xFF7DD3FC),
            secondary = Color(0xFF5EEAD4),
            background = Color(0xFF0B1220),
            surface = Color(0xFF111B2E),
        )
    } else {
        lightColorScheme(
            primary = Color(0xFF0B6BCB),
            secondary = Color(0xFF0F766E),
            background = Color(0xFFF5F8FC),
            surface = Color.White,
        )
    }
    MaterialTheme(colorScheme = colors, content = content)
}

private fun loadAsset(context: Context, path: String): String =
    context.assets.open(path).bufferedReader().use { it.readText() }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DemoApp() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val engine = remember { A2uiEngine() }

    var selectedId by remember { mutableStateOf(examples.first().id) }
    var jsonText by remember { mutableStateOf("") }
    var actionLog by remember { mutableStateOf("点击组件试试；Button 的 action 会回传到这里") }
    var showEditor by remember { mutableStateOf(false) }
    var replayJob by remember { mutableStateOf<Job?>(null) }
    var streamJob by remember { mutableStateOf<Job?>(null) }
    var showStream by remember { mutableStateOf(false) }
    var streamUrl by remember { mutableStateOf("http://127.0.0.1:8787/stream") }
    var streamStatus by remember { mutableStateOf("未连接") }
    var streamCount by remember { mutableStateOf(0) }

    fun applyRaw(raw: String, stream: Boolean, label: String) {
        replayJob?.cancel()
        engine.reset()
        jsonText = raw
        val messages = runCatching { messagesOf(raw) }.getOrNull().orEmpty()
        if (messages.isEmpty()) {
            engine.process(raw)
            actionLog = "无法解析：$label"
            return
        }
        actionLog = if (stream) "正在流式重放 $label…" else "已渲染 $label · ${messages.size} 条消息"
        replayJob = scope.launch {
            messages.forEachIndexed { index, message ->
                engine.processMessage(message)
                if (stream && index < messages.lastIndex) delay(450)
            }
            if (stream) actionLog = "流式重放完成 · ${messages.size} 条消息"
        }
    }

    fun connectStream() {
        replayJob?.cancel()
        streamJob?.cancel()
        engine.reset()
        jsonText = ""
        selectedId = "stream"
        streamCount = 0
        streamStatus = "连接中…"
        actionLog = "实时流已启动，等待服务端下发消息"
        streamJob = scope.launch {
            try {
                A2uiStreamClient(streamUrl).events().collect { event ->
                    when (event) {
                        is StreamEvent.Status -> streamStatus = event.text
                        is StreamEvent.Message -> {
                            engine.processMessage(event.json)
                            streamCount += 1
                            streamStatus = "已接收 $streamCount 条消息"
                        }
                    }
                }
                streamStatus = "流已结束"
            } finally {
                streamJob = null
            }
        }
    }

    LaunchedEffect(Unit) {
        val first = examples.first()
        applyRaw(loadAsset(context, first.asset), false, first.title)
    }

    val activeSurface = engine.surfaces.values.firstOrNull()

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
                title = {
                    Column {
                        Text("A2UI Android", fontWeight = FontWeight.SemiBold)
                        Text(
                            "JSON 驱动的 Compose 界面",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                actions = {
                    TextButton(onClick = { showEditor = true }) {
                        Text("编辑 JSON")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                examples.forEach { example ->
                    FilterChip(
                        selected = selectedId == example.id,
                        onClick = {
                            selectedId = example.id
                            applyRaw(loadAsset(context, example.asset), false, example.title)
                        },
                        label = { Text(example.title) },
                    )
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("渐进渲染", style = MaterialTheme.typography.titleSmall)
                    Text(
                        "先 createSurface / 骨架，再 updateDataModel 填数据",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                TextButton(
                    onClick = {
                        val label = examples.firstOrNull { it.id == selectedId }?.title ?: "自定义 JSON"
                        applyRaw(jsonText, true, label)
                    },
                ) {
                    Text("流式重放")
                }
                TextButton(onClick = { showStream = true }) {
                    Text("实时流")
                }
            }

            if (streamJob != null) {
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.primaryContainer,
                    ),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "● LIVE",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Spacer(Modifier.width(12.dp))
                        Text(streamStatus, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }

            engine.lastError?.let { error ->
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer,
                    ),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Column(Modifier.padding(14.dp)) {
                        Text("消息错误", fontWeight = FontWeight.SemiBold)
                        Text(
                            error,
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = FontFamily.Monospace,
                        )
                    }
                }
            }

            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(22.dp),
                color = MaterialTheme.colorScheme.surface,
                tonalElevation = 1.dp,
                shadowElevation = 1.dp,
            ) {
                Box(Modifier.padding(16.dp)) {
                    if (activeSurface != null) {
                        A2uiSurface(
                            state = activeSurface,
                            onAction = { name, actionContext ->
                                actionLog = "⚡ $name\n${actionContext.toString(2)}"
                            },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    } else {
                        Column(
                            modifier = Modifier.fillMaxWidth().heightIn(min = 160.dp),
                            verticalArrangement = Arrangement.Center,
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text("暂无界面", style = MaterialTheme.typography.titleMedium)
                            Text(
                                "选择示例，或点击右上角粘贴 A2UI JSON",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }

            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
                ),
                shape = RoundedCornerShape(14.dp),
            ) {
                Column(Modifier.padding(14.dp)) {
                    Text(
                        "ACTION 回传",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        actionLog,
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Text(
                "Surface: ${activeSurface?.id ?: "-"} · Catalog: v0.9 basic",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

    if (showStream) {
        ModalBottomSheet(
            onDismissRequest = { showStream = false },
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("实时流（SSE）", style = MaterialTheme.typography.titleMedium)
                Text(
                    "服务端逐条下发 A2UI 消息，App 边收边渲染。先在电脑上运行 server/a2ui_stream_server.py，再执行 adb reverse tcp:8787 tcp:8787。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = streamUrl,
                    onValueChange = { streamUrl = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("流地址") },
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                )
                Text(
                    streamStatus,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = { showStream = false }) { Text("关闭") }
                    Spacer(Modifier.width(8.dp))
                    if (streamJob == null) {
                        Button(onClick = {
                            showStream = false
                            connectStream()
                        }) { Text("连接") }
                    } else {
                        Button(onClick = {
                            streamJob?.cancel()
                            streamJob = null
                            streamStatus = "已断开"
                            actionLog = "实时流已断开"
                        }) { Text("断开") }
                    }
                }
                Spacer(Modifier.height(8.dp))
            }
        }
    }

    if (showEditor) {
        ModalBottomSheet(
            onDismissRequest = { showEditor = false },
            containerColor = MaterialTheme.colorScheme.surface,
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("粘贴 A2UI v0.9 消息", style = MaterialTheme.typography.titleMedium)
                Text(
                    "支持单条消息、消息数组，或带 messages 的示例文件；修改后点“渲染”立即生效。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = jsonText,
                    onValueChange = { jsonText = it },
                    modifier = Modifier.fillMaxWidth().height(360.dp),
                    textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    label = { Text("JSON") },
                    shape = RoundedCornerShape(12.dp),
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = { showEditor = false }) { Text("取消") }
                    Spacer(Modifier.width(8.dp))
                    Button(
                        onClick = {
                            selectedId = "custom"
                            showEditor = false
                            applyRaw(jsonText, false, "自定义 JSON")
                        },
                    ) { Text("渲染") }
                }
                Spacer(Modifier.height(8.dp))
            }
        }
    }
}
