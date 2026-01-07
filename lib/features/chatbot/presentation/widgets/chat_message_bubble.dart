import 'package:flutter/material.dart';

import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/modern_loading.dart';

/// [ChatMessageBubble] - Professional styled message bubble
/// 
/// Features:
/// - User messages: right-aligned with neon blue gradient
/// - Bot messages: left-aligned with dark glassmorphism
/// - Clean typing indicator animation
class ChatMessageBubble extends StatelessWidget {
  const ChatMessageBubble({
    super.key,
    required this.message,
    required this.isUser,
    this.timestamp,
    this.isLoading = false,
  });

  final String message;
  final bool isUser;
  final DateTime? timestamp;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: isUser ? 60 : 0,
        right: isUser ? 0 : 60,
        bottom: 12,
      ),
      child: Row(
        mainAxisAlignment: isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (!isUser) ...[
            // Bot avatar - professional style
            Container(
              width: 34,
              height: 34,
              margin: const EdgeInsets.only(right: 10),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [AppTheme.neonBlue, AppTheme.neonPurple],
                ),
                borderRadius: BorderRadius.circular(10),
                boxShadow: [
                  BoxShadow(
                    color: AppTheme.neonBlue.withOpacity(0.3),
                    blurRadius: 8,
                    spreadRadius: 1,
                  ),
                ],
              ),
              child: const Icon(
                Icons.psychology,
                color: Colors.white,
                size: 20,
              ),
            ),
          ],
          
          Flexible(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                gradient: isUser
                    ? LinearGradient(
                        colors: [
                          AppTheme.neonBlue,
                          AppTheme.neonBlue.withOpacity(0.85),
                        ],
                      )
                    : null,
                color: isUser ? null : const Color(0xFF1A1F35),
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(18),
                  topRight: const Radius.circular(18),
                  bottomLeft: Radius.circular(isUser ? 18 : 4),
                  bottomRight: Radius.circular(isUser ? 4 : 18),
                ),
                border: isUser
                    ? null
                    : Border.all(
                        color: AppTheme.neonBlue.withOpacity(0.15),
                      ),
                boxShadow: [
                  BoxShadow(
                    color: isUser
                        ? AppTheme.neonBlue.withOpacity(0.3)
                        : Colors.black.withOpacity(0.3),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: isLoading
                  ? _buildTypingIndicator()
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _buildFormattedMessage(message, isUser),
                        if (timestamp != null) ...[
                          const SizedBox(height: 6),
                          Text(
                            _formatTime(timestamp!),
                            style: TextStyle(
                              color: isUser 
                                  ? Colors.white.withOpacity(0.6)
                                  : Colors.grey.shade600,
                              fontSize: 10,
                              letterSpacing: 0.3,
                            ),
                          ),
                        ],
                      ],
                    ),
            ),
          ),
          
          if (isUser) ...[
            // User avatar
            Container(
              width: 34,
              height: 34,
              margin: const EdgeInsets.only(left: 10),
              decoration: BoxDecoration(
                color: AppTheme.neonBlue.withOpacity(0.15),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
              ),
              child: const Icon(
                Icons.person,
                color: AppTheme.neonBlue,
                size: 18,
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// Format message with markdown-like styling
  Widget _buildFormattedMessage(String text, bool isUser) {
    // Simple parsing for bold (**text**) and bullet points
    final lines = text.split('\n');
    
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: lines.map((line) {
        if (line.startsWith('•') || line.startsWith('-')) {
          // Bullet point
          return Padding(
            padding: const EdgeInsets.only(left: 4, bottom: 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 4,
                  height: 4,
                  margin: const EdgeInsets.only(top: 8, right: 8),
                  decoration: BoxDecoration(
                    color: isUser ? Colors.white70 : AppTheme.neonBlue,
                    shape: BoxShape.circle,
                  ),
                ),
                Expanded(
                  child: _parseInlineStyles(line.substring(1).trim(), isUser),
                ),
              ],
            ),
          );
        }
        return Padding(
          padding: const EdgeInsets.only(bottom: 4),
          child: _parseInlineStyles(line, isUser),
        );
      }).toList(),
    );
  }

  Widget _parseInlineStyles(String text, bool isUser) {
    // Parse **bold** text
    final regex = RegExp(r'\*\*(.+?)\*\*');
    final matches = regex.allMatches(text);
    
    if (matches.isEmpty) {
      return Text(
        text,
        style: TextStyle(
          color: isUser ? Colors.white : Colors.grey.shade300,
          fontSize: 14,
          height: 1.5,
        ),
      );
    }
    
    List<InlineSpan> spans = [];
    int lastEnd = 0;
    
    for (final match in matches) {
      if (match.start > lastEnd) {
        spans.add(TextSpan(text: text.substring(lastEnd, match.start)));
      }
      spans.add(TextSpan(
        text: match.group(1),
        style: const TextStyle(fontWeight: FontWeight.bold),
      ));
      lastEnd = match.end;
    }
    
    if (lastEnd < text.length) {
      spans.add(TextSpan(text: text.substring(lastEnd)));
    }
    
    return RichText(
      text: TextSpan(
        style: TextStyle(
          color: isUser ? Colors.white : Colors.grey.shade300,
          fontSize: 14,
          height: 1.5,
        ),
        children: spans,
      ),
    );
  }

  Widget _buildTypingIndicator() {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      alignment: Alignment.centerLeft,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: const [
          SizedBox(
            width: 40,
            height: 40,
            child: ModernLoading(size: 30),
          ),
          SizedBox(width: 12),
          Text(
            'Procesando...',
            style: TextStyle(
              fontSize: 12,
              color: AppTheme.neonBlue,
              fontStyle: FontStyle.italic,
            ),
          ),
        ],
      ),
    );
  }

  String _formatTime(DateTime time) {
    final hour = time.hour.toString().padLeft(2, '0');
    final minute = time.minute.toString().padLeft(2, '0');
    return '$hour:$minute';
  }
}
