package com.maripepa.gmp_mobilidad

import android.content.ClipData
import android.content.Intent
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            CHANNEL,
        ).setMethodCallHandler { call, result ->
            if (call.method != "sharePdf") {
                result.notImplemented()
                return@setMethodCallHandler
            }
            val path = call.argument<String>("path")
            val phone = call.argument<String>("phone") ?: ""
            val text = call.argument<String>("text") ?: ""
            if (path.isNullOrBlank()) {
                result.error("PATH_REQUIRED", "PDF path required", null)
                return@setMethodCallHandler
            }
            try {
                result.success(sharePdf(path, phone, text))
            } catch (error: Exception) {
                result.error("SHARE_FAILED", error.message, null)
            }
        }
    }

    /**
     * One WhatsApp send: the PDF is the document and [text] is its caption.
     * A wa.me link cannot attach a file, so this intent is the only local path.
     */
    private fun sharePdf(path: String, phone: String, text: String): Boolean {
        val file = File(path)
        if (!file.exists() || file.length() == 0L) return false
        val uri = FileProvider.getUriForFile(
            this,
            "${applicationContext.packageName}.whatsapp.fileprovider",
            file,
        )
        val digits = phone.filter { it.isDigit() }
        for (pkg in WHATSAPP_PACKAGES) {
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "application/pdf"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_TEXT, text)
                if (digits.length in 7..15) {
                    putExtra("jid", "$digits@s.whatsapp.net")
                }
                clipData = ClipData.newRawUri("pdf", uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                setPackage(pkg)
            }
            if (intent.resolveActivity(packageManager) == null) continue
            grantUriPermission(pkg, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            startActivity(intent)
            return true
        }
        return false
    }

    companion object {
        private const val CHANNEL = "gmp/whatsapp_document"
        private val WHATSAPP_PACKAGES = listOf("com.whatsapp", "com.whatsapp.w4b")
    }
}
