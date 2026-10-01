import 'package:flutter/material.dart';
import 'package:gmp_app_mobilidad/core/theme/app_colors.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/utils/responsive.dart';

/// Phone chrome. The bottom bar is the only owner of the system bottom inset.
///
/// Scaffold already ends the body at the top of [bottomBar] and clears
/// `MediaQuery.padding.bottom` on the body while leaving `viewPadding` intact.
/// A body [SafeArea] with `minimum: viewPadding.bottom` therefore inserts a
/// second copy of that inset. That gap is painted by the dark shell gradient
/// and shows up as a black band above the bar. Top and side insets stay on
/// the body; the bar's own [SafeArea] consumes the bottom inset once.
@visibleForTesting
class PhoneShellScaffold extends StatelessWidget {
  const PhoneShellScaffold({
    required this.body,
    required this.bottomBar,
    super.key,
    this.drawer,
  });

  final Widget body;
  final Widget bottomBar;
  final Widget? drawer;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.transparent,
      drawer: drawer,
      body: DecoratedBox(
        decoration: AppTheme.appBackground(),
        child: SafeArea(
          bottom: false,
          child: body,
        ),
      ),
      bottomNavigationBar: bottomBar,
    );
  }
}

/// Dark command bar. [SafeArea] reads `MediaQuery.padding.bottom` once.
/// Do not also pass `minimum: viewPadding`: that is a second inset source.
@visibleForTesting
class PhoneShellBottomBar extends StatelessWidget {
  const PhoneShellBottomBar({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('shell-phone-nav-bar'),
      decoration: BoxDecoration(
        gradient: AppTheme.commandGradient,
        border: Border(
          top: BorderSide(
            color: AppTheme.activeRing.withValues(alpha: 0.16),
          ),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.systemBlack.withValues(alpha: 0.42),
            blurRadius: 24,
            offset: const Offset(0, -10),
          ),
          BoxShadow(
            color: AppTheme.activeRing.withValues(alpha: 0.06),
            blurRadius: 28,
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: child,
        ),
      ),
    );
  }
}

/// Tablet and desktop chrome. There is no bottom bar, so this [SafeArea] is
/// the single bottom-inset owner. `minimum` is the floor of the system inset;
/// [SafeArea] uses the greater of padding and minimum, not the sum.
@visibleForTesting
class TabletShellScaffold extends StatelessWidget {
  const TabletShellScaffold({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.transparent,
      body: DecoratedBox(
        decoration: AppTheme.appBackground(),
        child: SafeArea(
          minimum: EdgeInsets.only(
            bottom: Responsive.bottomSafeInset(context),
          ),
          child: child,
        ),
      ),
    );
  }
}
