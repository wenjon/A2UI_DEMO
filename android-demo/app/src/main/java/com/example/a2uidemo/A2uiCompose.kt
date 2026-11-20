package com.example.a2uidemo

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject

@Composable
fun A2uiSurface(
    state: SurfaceState,
    onAction: (String, JSONObject) -> Unit,
    modifier: Modifier = Modifier,
) {
    val root = state.components["root"]
    if (root == null) {
        Box(
            modifier = modifier.fillMaxWidth().height(180.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text("等待 updateComponents…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    } else {
        RenderNode(root, state, state.data, onAction, modifier)
    }
}

@Composable
private fun RenderNode(
    node: JSONObject,
    state: SurfaceState,
    data: Any?,
    onAction: (String, JSONObject) -> Unit,
    modifier: Modifier = Modifier,
) {
    when (node.optString("component")) {
        "Text" -> {
            val variant = node.optString("variant", "body")
            val style = when (variant) {
                "h1" -> MaterialTheme.typography.headlineLarge
                "h2" -> MaterialTheme.typography.headlineMedium
                "h3" -> MaterialTheme.typography.headlineSmall
                "h4" -> MaterialTheme.typography.titleLarge
                "h5" -> MaterialTheme.typography.titleMedium
                "caption" -> MaterialTheme.typography.bodySmall
                else -> MaterialTheme.typography.bodyMedium
            }
            Text(
                text = dynString(node.opt("text"), data, state.data),
                modifier = modifier,
                style = style,
                color = if (variant == "caption") MaterialTheme.colorScheme.onSurfaceVariant
                else MaterialTheme.colorScheme.onSurface,
            )
        }

        "Column" -> {
            Column(
                modifier = modifier.fillMaxWidth(),
                verticalArrangement = verticalArrangement(node.optString("justify", "start")),
                horizontalAlignment = horizontalAlignment(node.optString("align", "stretch")),
            ) {
                childRefs(node, state, data).forEach { (child, childData) ->
                    RenderNode(child, state, childData, onAction, Modifier.fillMaxWidth())
                }
            }
        }

        "Row" -> {
            val refs = childRefs(node, state, data)
            val justify = node.optString("justify", "start")
            val flexible = refs.any { (child, _) -> child.optString("component") in flexibleRowComponents }
            Row(
                modifier = modifier.fillMaxWidth(),
                horizontalArrangement = if (justify == "spaceBetween" && flexible) {
                    Arrangement.spacedBy(12.dp)
                } else {
                    horizontalArrangement(justify)
                },
                verticalAlignment = verticalAlignment(node.optString("align", "stretch")),
            ) {
                refs.forEach { (child, childData) ->
                    val childModifier = if (child.optString("component") in flexibleRowComponents) {
                        Modifier.weight(1f)
                    } else {
                        Modifier
                    }
                    RenderNode(child, state, childData, onAction, childModifier)
                }
            }
        }

        "Card" -> {
            val child = childOf(node, state)
            Card(
                modifier = modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
            ) {
                Box(Modifier.padding(16.dp)) {
                    child?.let { RenderNode(it, state, data, onAction, Modifier.fillMaxWidth()) }
                }
            }
        }

        "Button" -> {
            val child = childOf(node, state)
            val variant = node.optString("variant", "default")
            val action = actionOf(node)
            val enabled = dynBool(node.opt("enabled"), data, state.data) ?: true
            val onClick: () -> Unit = {
                if (action != null) onAction(action.name, resolveContext(action.context, data, state.data))
            }
            val content: @Composable () -> Unit = {
                child?.let { RenderNode(it, state, data, onAction) }
            }
            when (variant) {
                "primary" -> Button(
                    onClick = onClick,
                    enabled = enabled,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                    ),
                ) { content() }

                "borderless" -> TextButton(onClick = onClick, enabled = enabled) { content() }

                else -> OutlinedButton(onClick = onClick, enabled = enabled) { content() }
            }
        }

        "TextField" -> {
            val label = dynString(node.opt("label"), data, state.data)
            val variant = node.optString("variant", "shortText")
            val path = bindingPath(node.opt("value"))
            var localValue by remember(node.toString(), path) {
                mutableStateOf(dynString(node.opt("value"), data, state.data))
            }
            val value = if (path != null) dynString(node.opt("value"), data, state.data) else localValue
            OutlinedTextField(
                value = value,
                onValueChange = { next ->
                    if (path != null) state.setPath(path, next) else localValue = next
                },
                modifier = modifier.fillMaxWidth(),
                label = { Text(label) },
                singleLine = variant != "longText",
                minLines = if (variant == "longText") 3 else 1,
                visualTransformation = if (variant == "obscured") {
                    PasswordVisualTransformation()
                } else {
                    VisualTransformation.None
                },
                keyboardOptions = KeyboardOptions(
                    keyboardType = if (variant == "number") KeyboardType.Number else KeyboardType.Text,
                ),
                shape = RoundedCornerShape(12.dp),
            )
        }

        "CheckBox" -> {
            val label = dynString(node.opt("label"), data, state.data)
            val path = bindingPath(node.opt("value"))
            var localChecked by remember(node.toString(), path) {
                mutableStateOf(dynBool(node.opt("value"), data, state.data) ?: false)
            }
            val checked = if (path != null) {
                dynBool(node.opt("value"), data, state.data) ?: false
            } else {
                localChecked
            }
            Row(
                modifier = modifier.fillMaxWidth().clickable {
                    if (path != null) state.setPath(path, !checked) else localChecked = !checked
                },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(
                    checked = checked,
                    onCheckedChange = { next ->
                        if (path != null) state.setPath(path, next) else localChecked = next
                    },
                )
                Spacer(Modifier.width(8.dp))
                Text(label)
            }
        }

        "Slider" -> {
            val label = dynString(node.opt("label"), data, state.data)
            val min = node.optDouble("min", 0.0)
            val max = node.optDouble("max", 1.0).coerceAtLeast(min + 0.0001)
            val path = bindingPath(node.opt("value"))
            var localValue by remember(node.toString(), path) {
                mutableFloatStateOf((dynNumber(node.opt("value"), data, state.data) ?: min).toFloat())
            }
            val value = if (path != null) {
                (dynNumber(node.opt("value"), data, state.data) ?: min).toFloat().coerceIn(min.toFloat(), max.toFloat())
            } else {
                localValue.coerceIn(min.toFloat(), max.toFloat())
            }
            Column(modifier.fillMaxWidth()) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(label)
                    Text(formatNumber(value.toDouble()), color = MaterialTheme.colorScheme.primary)
                }
                Slider(
                    value = value,
                    onValueChange = { next ->
                        if (path != null) state.setPath(path, next.toDouble()) else localValue = next
                    },
                    valueRange = min.toFloat()..max.toFloat(),
                )
            }
        }

        "Divider" -> {
            if (node.optString("axis", "horizontal") == "vertical") {
                VerticalDivider(Modifier.height(28.dp).width(1.dp))
            } else {
                HorizontalDivider(modifier.fillMaxWidth().padding(vertical = 4.dp))
            }
        }

        "Image" -> {
            val description = dynString(node.opt("description"), data, state.data).ifBlank { "图片" }
            val url = dynString(node.opt("url"), data, state.data)
            Box(
                modifier = modifier
                    .fillMaxWidth()
                    .height(170.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(
                        Brush.linearGradient(
                            listOf(Color(0xFF0F4C81), Color(0xFF14B8A6)),
                        ),
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("🖼", fontSize = 34.sp)
                    Text(
                        description,
                        color = Color.White,
                        style = MaterialTheme.typography.titleMedium,
                        textAlign = TextAlign.Center,
                    )
                    if (url.isNotBlank()) {
                        Text(
                            "网络图片占位",
                            color = Color.White.copy(alpha = 0.72f),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
        }

        "Icon" -> {
            val symbols = mapOf(
                "favorite" to "♥", "favoriteOff" to "♡", "add" to "＋", "close" to "✕",
                "check" to "✓", "delete" to "🗑", "edit" to "✎", "download" to "⬇",
                "arrowBack" to "←", "arrowForward" to "→", "search" to "🔍",
                "calendarToday" to "📅", "call" to "☎", "camera" to "📷", "folder" to "📁",
                "help" to "?", "error" to "!", "info" to "i", "star" to "★",
            )
            Text(
                text = symbols[node.optString("name")] ?: "●",
                modifier = modifier,
                fontSize = 22.sp,
            )
        }

        "List" -> {
            val direction = node.optString("direction", "vertical")
            val refs = childRefs(node, state, data)
            if (direction == "horizontal") {
                Row(
                    modifier = modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    refs.forEach { (child, childData) ->
                        RenderNode(child, state, childData, onAction)
                    }
                }
            } else {
                Column(
                    modifier = modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    refs.forEach { (child, childData) ->
                        RenderNode(child, state, childData, onAction, Modifier.fillMaxWidth())
                    }
                }
            }
        }

        else -> {
            Box(
                modifier = modifier
                    .fillMaxWidth()
                    .border(
                        width = 1.dp,
                        color = MaterialTheme.colorScheme.outlineVariant,
                        shape = RoundedCornerShape(10.dp),
                    )
                    .padding(12.dp),
            ) {
                Text(
                    "未实现的组件：${node.optString("component")}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}

private val flexibleRowComponents = setOf("Card", "Column", "List", "Box")

private fun childOf(node: JSONObject, state: SurfaceState): JSONObject? =
    node.optString("child").takeIf { it.isNotBlank() }?.let { state.components[it] }

private fun childRefs(
    node: JSONObject,
    state: SurfaceState,
    data: Any?,
): List<Pair<JSONObject, Any?>> {
    val children = node.opt("children") ?: return emptyList()
    if (children is JSONArray) {
        return (0 until children.length()).mapNotNull { index ->
            state.components[children.optString(index)]?.let { it to data }
        }
    }
    if (children is JSONObject) {
        val template = state.components[children.optString("componentId")] ?: return emptyList()
        val list = readPath(children.optString("path"), data) as? JSONArray ?: return emptyList()
        return (0 until list.length()).mapNotNull { index ->
            val item = list.opt(index)
            template to item
        }
    }
    return emptyList()
}

private fun bindingPath(value: Any?): String? =
    (value as? JSONObject)?.optString("path")?.takeIf { it.isNotBlank() }

private fun verticalArrangement(name: String): Arrangement.Vertical = when (name) {
    "center" -> Arrangement.spacedBy(12.dp, Alignment.CenterVertically)
    "end" -> Arrangement.spacedBy(12.dp, Alignment.Bottom)
    "spaceBetween" -> Arrangement.SpaceBetween
    "spaceAround" -> Arrangement.SpaceAround
    "spaceEvenly" -> Arrangement.SpaceEvenly
    else -> Arrangement.spacedBy(12.dp)
}

private fun horizontalArrangement(name: String): Arrangement.Horizontal = when (name) {
    "center" -> Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally)
    "end" -> Arrangement.spacedBy(12.dp, Alignment.End)
    "spaceBetween" -> Arrangement.SpaceBetween
    "spaceAround" -> Arrangement.SpaceAround
    "spaceEvenly" -> Arrangement.SpaceEvenly
    else -> Arrangement.spacedBy(12.dp)
}

private fun horizontalAlignment(name: String): Alignment.Horizontal = when (name) {
    "center" -> Alignment.CenterHorizontally
    "end" -> Alignment.End
    else -> Alignment.Start
}

private fun verticalAlignment(name: String): Alignment.Vertical = when (name) {
    "center" -> Alignment.CenterVertically
    "end" -> Alignment.Bottom
    else -> Alignment.Top
}
