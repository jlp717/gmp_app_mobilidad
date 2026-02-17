import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_pdfview/flutter_pdfview.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../theme/app_theme.dart';

/// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/// 📄 PDF PREVIEW SCREEN
/// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
///
/// Pantalla full-screen con visor PDF + acciones en barra inferior.
///
/// Uso:
///   Navigator.push(context, MaterialPageRoute(
///     builder: (_) => PdfPreviewScreen(
///       pdfBytes: bytes,
///       title: 'Factura FAV-1234',
///       fileName: 'Factura_FAV_1234_2026.pdf',
///       onEmailTap: () => showEmailModal(...),
///       onWhatsAppTap: () => showWhatsAppModal(...),
///     ),
///   ));
/// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class PdfPreviewScreen extends StatefulWidget {
  final Uint8List pdfBytes;
  final String title;
  final String fileName;
  final VoidCallback? onEmailTap;
  final VoidCallback? onWhatsAppTap;

  const PdfPreviewScreen({
    super.key,
    required this.pdfBytes,
    required this.title,
    required this.fileName,
    this.onEmailTap,
    this.onWhatsAppTap,
  });

  @override
  State<PdfPreviewScreen> createState() => _PdfPreviewScreenState();
}

class _PdfPreviewScreenState extends State<PdfPreviewScreen> {
  String? _tempPath;
  int _totalPages = 0;
  int _currentPage = 0;
  bool _isReady = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _writeTempFile();
  }

  Future<void> _writeTempFile() async {
    try {
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/${widget.fileName}');
      await file.writeAsBytes(widget.pdfBytes);
      if (mounted) {
        setState(() => _tempPath = file.path);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _errorMessage = 'Error preparando PDF: $e');
      }
    }
  }

  Future<void> _downloadPdf() async {
    try {
      final downloadsDir = Directory('/storage/emulated/0/Download');
      if (!await downloadsDir.exists()) {
        await downloadsDir.create(recursive: true);
      }

      final savedFile = File('${downloadsDir.path}/${widget.fileName}');
      await savedFile.writeAsBytes(widget.pdfBytes);

      if (mounted) {
        HapticFeedback.lightImpact();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.check_circle, color: Colors.white, size: 20),
                const SizedBox(width: 10),
                Expanded(child: Text('✓ Guardado: ${widget.fileName}')),
              ],
            ),
            backgroundColor: AppTheme.success,
            duration: const Duration(seconds: 3),
            action: SnackBarAction(
              label: 'ABRIR',
              textColor: Colors.white,
              onPressed: () async {
                await Share.shareXFiles([XFile(savedFile.path)]);
              },
            ),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error al descargar: $e'),
            backgroundColor: AppTheme.error,
          ),
        );
      }
    }
  }

  Future<void> _sharePdf() async {
    try {
      if (_tempPath == null) return;
      await Share.shareXFiles(
        [XFile(_tempPath!)],
        text: widget.title,
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error al compartir: $e'), backgroundColor: AppTheme.error),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      appBar: AppBar(
        backgroundColor: AppTheme.darkSurface,
        leading: IconButton(
          icon: const Icon(Icons.close, color: AppTheme.textPrimary),
          onPressed: () => Navigator.pop(context),
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.title,
              style: const TextStyle(
                color: AppTheme.textPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            if (_isReady && _totalPages > 0)
              Text(
                'Página ${_currentPage + 1} de $_totalPages',
                style: const TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 12,
                ),
              ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.share, color: AppTheme.neonBlue),
            tooltip: 'Compartir',
            onPressed: _sharePdf,
          ),
        ],
      ),
      body: _buildBody(),
      bottomNavigationBar: _buildBottomBar(),
    );
  }

  Widget _buildBody() {
    if (_errorMessage != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, color: AppTheme.error, size: 56),
            const SizedBox(height: 16),
            Text(
              _errorMessage!,
              style: const TextStyle(color: AppTheme.textSecondary, fontSize: 14),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: () {
                setState(() {
                  _errorMessage = null;
                  _tempPath = null;
                });
                _writeTempFile();
              },
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('Reintentar'),
            ),
          ],
        ),
      );
    }

    if (_tempPath == null) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox(
              width: 48,
              height: 48,
              child: CircularProgressIndicator(
                color: AppTheme.neonBlue,
                strokeWidth: 3,
              ),
            ),
            SizedBox(height: 16),
            Text(
              'Cargando PDF...',
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 14),
            ),
          ],
        ),
      );
    }

    return PDFView(
      filePath: _tempPath!,
      enableSwipe: true,
      swipeHorizontal: false,
      autoSpacing: true,
      pageFling: true,
      pageSnap: true,
      fitPolicy: FitPolicy.WIDTH,
      nightMode: true,
      onRender: (pages) {
        if (mounted) {
          setState(() {
            _totalPages = pages ?? 0;
            _isReady = true;
          });
        }
      },
      onViewCreated: (controller) {},
      onPageChanged: (page, total) {
        if (mounted) {
          setState(() {
            _currentPage = page ?? 0;
          });
        }
      },
      onError: (error) {
        if (mounted) {
          setState(() => _errorMessage = 'Error renderizando PDF: $error');
        }
      },
      onPageError: (page, error) {
        if (mounted) {
          setState(() => _errorMessage = 'Error en página ${page ?? 0}: $error');
        }
      },
    );
  }

  Widget _buildBottomBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: AppTheme.darkSurface,
        border: Border(
          top: BorderSide(color: AppTheme.borderColor.withOpacity(0.5)),
        ),
      ),
      child: SafeArea(
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            _buildActionButton(
              icon: Icons.download_rounded,
              label: 'Descargar',
              color: AppTheme.neonGreen,
              onTap: _downloadPdf,
            ),
            _buildActionButton(
              icon: Icons.email_outlined,
              label: 'Email',
              color: AppTheme.neonBlue,
              onTap: widget.onEmailTap,
            ),
            _buildActionButton(
              icon: Icons.chat,
              label: 'WhatsApp',
              color: const Color(0xFF25D366),
              onTap: widget.onWhatsAppTap,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildActionButton({
    required IconData icon,
    required String label,
    required Color color,
    VoidCallback? onTap,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
          decoration: BoxDecoration(
            color: color.withOpacity(0.1),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: color.withOpacity(0.3)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: color, size: 20),
              const SizedBox(width: 8),
              Text(
                label,
                style: TextStyle(
                  color: color,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
