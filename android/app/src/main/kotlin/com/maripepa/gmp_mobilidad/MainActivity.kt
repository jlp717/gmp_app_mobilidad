package com.maripepa.gmp_mobilidad

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipDescription
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
            val path = call.argument<String>("path")
            if (path.isNullOrBlank()) {
                result.error("PATH_REQUIRED", "PDF path required", null)
                return@setMethodCallHandler
            }
            try {
                val opened = when (call.method) {
                    "sharePdf" -> sharePdf(
                        path,
                        call.argument<String>("phone") ?: "",
                        call.argument<String>("text") ?: "",
                    )
                    "shareGmail" -> shareGmail(
                        path,
                        call.argument<String>("email") ?: "",
                        call.argument<String>("subject") ?: "",
                        call.argument<String>("text") ?: "",
                    )
                    else -> {
                        result.notImplemented()
                        return@setMethodCallHandler
                    }
                }
                result.success(opened)
            } catch (error: Exception) {
                result.error("SHARE_FAILED", error.message, null)
            }
        }
    }

    private fun pdfUri(path: String) = run {
        val file = File(path)
        if (!file.exists() || file.length() == 0L) null
        else FileProvider.getUriForFile(
            this,
            "${applicationContext.packageName}.whatsapp.fileprovider",
            file,
        ) to file
    }

    /**
     * Opens WhatsApp on that chat with the PDF attached and [text] as the
     * message under the file, the same way a photo carries a caption.
     *
     * WhatsApp drops the caption when one clip item holds both the text and
     * the file URI: it keeps the PDF and sends nothing else. The caption is
     * its own item; the PDF is the next one, and also [Intent.EXTRA_STREAM].
     */
    private fun sharePdf(path: String, phone: String, text: String): Boolean {
        val (uri, file) = pdfUri(path) ?: return false
        val digits = phone.filter { it.isDigit() }
        val jid = if (digits.length in 7..15) "$digits@s.whatsapp.net" else null
        val caption = text.trim().take(1024)
        for (pkg in WHATSAPP_PACKAGES) {
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "application/pdf"
                putExtra(Intent.EXTRA_STREAM, uri)
                if (caption.isNotEmpty()) {
                    putExtra(Intent.EXTRA_TEXT, caption)
                    putExtra("caption", caption)
                    putExtra("skip_preview", false)
                    val clip = ClipData(
                        ClipDescription(
                            file.name,
                            arrayOf(ClipDescription.MIMETYPE_TEXT_PLAIN, "application/pdf"),
                        ),
                        ClipData.Item(caption),
                    )
                    clip.addItem(ClipData.Item(uri))
                    clipData = clip
                } else {
                    clipData = ClipData.newUri(contentResolver, file.name, uri)
                }
                if (jid != null) putExtra("jid", jid)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                setPackage(pkg)
            }
            try {
                grantUriPermission(pkg, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                startActivity(intent)
                return true
            } catch (_: ActivityNotFoundException) {
                continue
            }
        }
        return false
    }

    /** Opens Gmail compose with the PDF already attached. */
    private fun shareGmail(path: String, email: String, subject: String, text: String): Boolean {
        val (uri, file) = pdfUri(path) ?: return false
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, subject)
            putExtra(Intent.EXTRA_TEXT, text)
            if (email.isNotBlank()) putExtra(Intent.EXTRA_EMAIL, arrayOf(email))
            clipData = ClipData.newUri(contentResolver, file.name, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            setPackage(GMAIL_PACKAGE)
        }
        return try {
            grantUriPermission(GMAIL_PACKAGE, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            startActivity(intent)
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }

    companion object {
        private const val CHANNEL = "gmp/whatsapp_document"
        private val WHATSAPP_PACKAGES = listOf("com.whatsapp", "com.whatsapp.w4b")
        private const val GMAIL_PACKAGE = "com.google.android.gm"
    }
}
