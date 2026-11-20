package com.example.a2uidemo

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.text.NumberFormat
import java.util.Locale

class SurfaceState(val id: String, val catalogId: String) {
    val components = mutableStateMapOf<String, JSONObject>()
    var data by mutableStateOf(JSONObject())
        private set

    fun updateData(path: String?, value: Any?) {
        val pointer = path?.trim().orEmpty()
        if (pointer.isEmpty() || pointer == "/") {
            data = if (value is JSONObject) deepCopy(value) else JSONObject()
            return
        }
        val root = deepCopy(data)
        val tokens = pointerTokens(pointer)
        if (value == null || value == JSONObject.NULL) {
            removeAt(root, tokens)
        } else {
            setAt(root, tokens, value)
        }
        data = root
    }

    fun setPath(path: String, value: Any?) {
        val root = deepCopy(data)
        setAt(root, pointerTokens(path), value)
        data = root
    }
}

class A2uiEngine {
    val surfaces = mutableStateMapOf<String, SurfaceState>()
    var lastError by mutableStateOf<String?>(null)
        private set

    fun reset() {
        surfaces.clear()
        lastError = null
    }

    fun process(raw: String) {
        val text = raw.trim()
        if (text.isEmpty()) return
        lastError = null
        runCatching {
            when (val parsed = JSONTokener(text).nextValue()) {
                is JSONArray -> for (i in 0 until parsed.length()) {
                    (parsed.opt(i) as? JSONObject)?.let { processOne(it) }
                }
                is JSONObject -> processOne(parsed)
                else -> error("不是合法的 A2UI JSON 对象或数组")
            }
        }.onFailure { lastError = it.message ?: it.javaClass.simpleName }
    }

    fun processMessage(message: JSONObject) {
        lastError = null
        runCatching { processOne(message) }
            .onFailure { lastError = it.message ?: it.javaClass.simpleName }
    }

    private fun processOne(message: JSONObject) {
        if (message.has("messages")) {
            val list = message.optJSONArray("messages") ?: return
            for (i in 0 until list.length()) {
                (list.opt(i) as? JSONObject)?.let { processOne(it) }
            }
            return
        }

        when {
            message.has("createSurface") -> {
                val create = message.getJSONObject("createSurface")
                val surfaceId = create.getString("surfaceId")
                surfaces[surfaceId] = SurfaceState(surfaceId, create.optString("catalogId"))
            }

            message.has("updateComponents") -> {
                val update = message.getJSONObject("updateComponents")
                val state = surfaces[update.getString("surfaceId")]
                    ?: error("updateComponents 前没有 createSurface")
                val components = update.getJSONArray("components")
                for (i in 0 until components.length()) {
                    val component = components.getJSONObject(i)
                    state.components[component.getString("id")] = component
                }
            }

            message.has("updateDataModel") -> {
                val update = message.getJSONObject("updateDataModel")
                val state = surfaces[update.getString("surfaceId")]
                    ?: error("updateDataModel 前没有 createSurface")
                state.updateData(
                    path = update.optString("path", "/"),
                    value = if (update.has("value")) update.opt("value") else null,
                )
            }

            message.has("deleteSurface") -> {
                surfaces.remove(message.getJSONObject("deleteSurface").getString("surfaceId"))
            }

            else -> error("未知 A2UI 消息")
        }
    }
}

fun messagesOf(raw: String): List<JSONObject> {
    val parsed = JSONTokener(raw.trim()).nextValue()
    return when (parsed) {
        is JSONArray -> (0 until parsed.length()).mapNotNull { parsed.opt(it) as? JSONObject }
        is JSONObject -> {
            val nested = parsed.optJSONArray("messages")
            if (nested != null) {
                (0 until nested.length()).mapNotNull { nested.opt(it) as? JSONObject }
            } else {
                listOf(parsed)
            }
        }
        else -> emptyList()
    }
}

fun deepCopy(value: JSONObject): JSONObject = JSONObject(value.toString())

fun pointerTokens(path: String): List<String> =
    path.trim().split("/")
        .filter { it.isNotEmpty() }
        .map { it.replace("~1", "/").replace("~0", "~") }

fun readPath(path: String, data: Any?): Any? {
    val pointer = path.trim()
    if (pointer.isEmpty() || pointer == "/") return data
    var current: Any? = data
    for (token in pointerTokens(pointer)) {
        current = when (val node = current) {
            is JSONObject -> if (node.has(token)) node.opt(token) else null
            is JSONArray -> token.toIntOrNull()?.let { index ->
                if (index in 0 until node.length()) node.opt(index) else null
            }
            else -> null
        } ?: return null
    }
    return if (current == JSONObject.NULL) null else current
}

private fun pathValue(path: String, data: Any?, root: JSONObject): Any? {
    val local = readPath(path, data)
    if (local != null) return local
    return if (data !== root) readPath(path, root) else null
}

private fun setAt(root: JSONObject, tokens: List<String>, value: Any?) {
    if (tokens.isEmpty()) return
    var current = root
    for (index in 0 until tokens.lastIndex) {
        val key = tokens[index]
        val next = current.opt(key)
        if (next is JSONObject) {
            current = next
        } else {
            val created = JSONObject()
            current.put(key, created)
            current = created
        }
    }
    val leaf = tokens.last()
    if (value == null || value == JSONObject.NULL) {
        current.remove(leaf)
    } else {
        current.put(leaf, normalize(value))
    }
}

private fun removeAt(root: JSONObject, tokens: List<String>) {
    if (tokens.isEmpty()) return
    var current = root
    for (index in 0 until tokens.lastIndex) {
        current = current.optJSONObject(tokens[index]) ?: return
    }
    current.remove(tokens.last())
}

private fun normalize(value: Any?): Any = when (value) {
    is JSONObject -> deepCopy(value)
    is JSONArray -> JSONArray(value.toString())
    else -> value ?: JSONObject.NULL
}

private val placeholderPattern = Regex("""\$\s*\{(/[^}]*)\}""")

fun interpolateString(text: String, data: Any?, root: JSONObject): String {
    if (!placeholderPattern.containsMatchIn(text)) return text
    return placeholderPattern.replace(text) { match ->
        when (val resolved = pathValue(match.groupValues[1], data, root)) {
            null, JSONObject.NULL -> match.value
            is Number -> formatNumber(resolved.toDouble())
            is Boolean -> resolved.toString()
            else -> resolved.toString()
        }
    }
}

fun dynString(value: Any?, data: Any?, root: JSONObject): String = when (value) {
    null, JSONObject.NULL -> ""
    is String -> interpolateString(value, data, root)
    is Number -> formatNumber(value.toDouble())
    is Boolean -> value.toString()
    is JSONObject -> when {
        value.has("path") -> pathValue(value.optString("path"), data, root)?.let {
            if (it is String) it else it.toString()
        }.orEmpty()
        value.has("call") -> evalCall(value, data, root)?.toString().orEmpty()
        else -> value.toString()
    }
    else -> value.toString()
}

fun dynNumber(value: Any?, data: Any?, root: JSONObject): Double? = when (value) {
    is Number -> value.toDouble()
    is String -> value.toDoubleOrNull()
    is JSONObject -> when {
        value.has("path") -> when (val resolved = pathValue(value.optString("path"), data, root)) {
            is Number -> resolved.toDouble()
            is String -> resolved.toDoubleOrNull()
            else -> null
        }
        value.has("call") -> (evalCall(value, data, root) as? Number)?.toDouble()
        else -> null
    }
    else -> null
}

fun dynBool(value: Any?, data: Any?, root: JSONObject): Boolean? = when (value) {
    is Boolean -> value
    is String -> value.toBooleanStrictOrNull()
    is JSONObject -> when {
        value.has("path") -> when (val resolved = pathValue(value.optString("path"), data, root)) {
            is Boolean -> resolved
            is String -> resolved.toBooleanStrictOrNull()
            else -> null
        }
        value.has("call") -> evalCall(value, data, root) as? Boolean
        else -> null
    }
    else -> null
}

private fun evalCall(call: JSONObject, data: Any?, root: JSONObject): Any? {
    val name = call.optString("call")
    val args = call.optJSONObject("args") ?: JSONObject()
    return when (name) {
        "formatCurrency" -> {
            val number = dynNumber(args.opt("value"), data, root) ?: return ""
            formatCurrency(number, dynString(args.opt("currency"), data, root))
        }
        "formatNumber" -> formatNumber(dynNumber(args.opt("value"), data, root) ?: return "")
        "pluralize" -> {
            val number = dynNumber(args.opt("value"), data, root) ?: return ""
            if (number == 1.0) dynString(args.opt("one"), data, root)
            else dynString(args.opt("other"), data, root)
        }
        "formatString" -> {
            val template = dynString(args.opt("value"), data, root)
            Regex("""\$\{(/[^}]*)\}""").replace(template) { match ->
                dynString(JSONObject().put("path", match.groupValues[1]), data, root)
            }
        }
        else -> ""
    }
}

private fun formatCurrency(value: Double, currency: String): String = when (currency.uppercase()) {
    "CNY", "RMB" -> "¥" + String.format(Locale.US, "%.2f", value)
    "USD" -> "$" + String.format(Locale.US, "%.2f", value)
    "EUR" -> "€" + String.format(Locale.US, "%.2f", value)
    else -> currency + " " + String.format(Locale.US, "%.2f", value)
}

fun formatNumber(value: Double): String =
    if (value == value.toLong().toDouble()) {
        NumberFormat.getIntegerInstance(Locale.US).format(value.toLong())
    } else {
        NumberFormat.getNumberInstance(Locale.US).apply { maximumFractionDigits = 1 }.format(value)
    }

data class ActionSpec(val name: String, val context: JSONObject)

fun actionOf(node: JSONObject): ActionSpec? {
    val action = node.optJSONObject("action") ?: return null
    val event = action.optJSONObject("event")
    val name = event?.optString("name")?.takeIf { it.isNotBlank() }
        ?: action.optString("name").takeIf { it.isNotBlank() }
    val context = event?.optJSONObject("context")
        ?: action.optJSONObject("context")
        ?: JSONObject()
    return name?.let { ActionSpec(it, context) }
}

fun resolveContext(context: JSONObject, data: Any?, root: JSONObject): JSONObject {
    val out = JSONObject()
    val keys = context.keys()
    while (keys.hasNext()) {
        val key = keys.next()
        out.put(key, resolveValue(context.opt(key), data, root))
    }
    return out
}

private fun resolveValue(value: Any?, data: Any?, root: JSONObject): Any? = when (value) {
    null, JSONObject.NULL -> JSONObject.NULL
    is JSONObject -> {
        val path = value.optString("path")
        if (path.isNotBlank() && value.length() <= 2) {
            pathValue(path, data, root) ?: JSONObject.NULL
        } else {
            resolveContext(value, data, root)
        }
    }
    is JSONArray -> JSONArray().also { arr ->
        for (index in 0 until value.length()) {
            arr.put(resolveValue(value.opt(index), data, root))
        }
    }
    else -> value
}
