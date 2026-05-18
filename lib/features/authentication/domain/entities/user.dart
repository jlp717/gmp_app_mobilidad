/// Domain entity representing a user for dashboard display purposes.
/// This is distinct from UserModel (core/models) which handles auth concerns.
class User {

  const User({
    required this.id,
    required this.name,
    this.email,
    this.zone,
    this.lastLoginAt,
  });
  final String id;
  final String name;
  final String? email;
  final String? zone;
  final DateTime? lastLoginAt;

  /// Returns user initials (first letter of first two words).
  String get initials {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty) return 'U';
    if (parts.length == 1) return parts[0][0].toUpperCase();
    return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
  }
}
