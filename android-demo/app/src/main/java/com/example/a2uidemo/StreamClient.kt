package com.example.a2uidemo

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.channels.trySendBlocking
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

sealed interface StreamEvent {
    data class Status(val text: String) : StreamEvent
    data class Message(val json: JSONObject) : StreamEvent
}

class A2uiStreamClient(private val url: String) {

    fun events() = callbackFlow {
        var connection: HttpURLConnection? = null

        val worker = launch(Dispatchers.IO) {
            try {
                connection = (URL(url).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 8000
                    readTimeout = 0
                    requestMethod = "GET"
                    setRequestProperty("Accept", "text/event-stream")
                    setRequestProperty("Cache-Control", "no-cache")
                }
                val code = connection!!.responseCode
                if (code !in 200..299) {
                    trySendBlocking(StreamEvent.Status("HTTP $code"))
                    close()
                    return@launch
                }
                trySendBlocking(StreamEvent.Status("已连接，等待消息…"))
                BufferedReader(InputStreamReader(connection!!.inputStream, Charsets.UTF_8)).use { reader ->
                    val buffer = StringBuilder()
                    while (isActive) {
                        val line = reader.readLine() ?: break
                        if (line.isEmpty()) {
                            if (buffer.isNotEmpty()) {
                                val payload = buffer.toString()
                                buffer.setLength(0)
                                val json = runCatching { JSONObject(payload) }.getOrNull()
                                if (json != null) trySendBlocking(StreamEvent.Message(json))
                            }
                        } else if (line.startsWith("data:")) {
                            if (buffer.isNotEmpty()) buffer.append('\n')
                            buffer.append(line.removePrefix("data:").trimStart())
                        }
                    }
                }
                trySendBlocking(StreamEvent.Status("流已结束"))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                trySendBlocking(StreamEvent.Status("连接失败：${e.message ?: e.javaClass.simpleName}"))
            } finally {
                connection?.disconnect()
                close()
            }
        }

        awaitClose {
            connection?.disconnect()
            worker.cancel()
        }
    }
}