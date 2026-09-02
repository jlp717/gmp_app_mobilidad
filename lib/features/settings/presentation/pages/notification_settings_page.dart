import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gmp_app_mobilidad/core/notifications/local_notification_service.dart';
import 'package:gmp_app_mobilidad/core/notifications/notification_models.dart';
import 'package:gmp_app_mobilidad/core/notifications/notification_orchestrator.dart';
import 'package:gmp_app_mobilidad/core/notifications/notification_preferences.dart';
import 'package:gmp_app_mobilidad/core/theme/app_theme.dart';
import 'package:gmp_app_mobilidad/core/theme/theme_provider.dart';

class NotificationSettingsPage extends ConsumerStatefulWidget {
  const NotificationSettingsPage({super.key});

  @override
  ConsumerState<NotificationSettingsPage> createState() =>
      _NotificationSettingsPageState();
}

class _NotificationSettingsPageState
    extends ConsumerState<NotificationSettingsPage> {
  NotificationPreferences? _settings;
  bool _loading = true;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final settings = await NotificationPreferencesService.instance.load();
    if (!mounted) return;
    setState(() {
      _settings = settings;
      _loading = false;
    });
  }

  Future<void> _apply(
    Future<NotificationPreferences> Function() action, {
    bool refresh = true,
  }) async {
    setState(() => _saving = true);
    try {
      final next = await action();
      if (refresh) {
        await NotificationOrchestrator.instance.refreshAll(
          reason: 'settings_changed',
        );
      }
      if (!mounted) return;
      setState(() => _settings = next);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('No se pudo guardar el ajuste: $error')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _requestPermission() async {
    setState(() => _saving = true);
    try {
      await LocalNotificationService.instance.requestPermissionsIfNeeded();
      await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('No se pudo solicitar el permiso: $error')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final settings = _settings;
    return Scaffold(
      backgroundColor: AppTheme.inkSurface,
      appBar: AppBar(
        title: const Text('Avisos'),
        backgroundColor: AppTheme.raisedSurface,
        actions: [
          IconButton(
            tooltip: 'Comprobar ahora',
            onPressed: _saving
                ? null
                : () => NotificationOrchestrator.instance.refreshAll(
                      reason: 'settings_manual_refresh',
                    ),
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: _loading || settings == null
          ? const Center(child: CircularProgressIndicator(color: AppTheme.info))
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _section(
                  title: 'General',
                  children: [
                    SwitchListTile.adaptive(
                      value: settings.enabled,
                      activeColor: AppTheme.info,
                      title: const Text('Notificaciones activas'),
                      subtitle: const Text(
                        'Permite avisos fuera de la aplicacion solo cuando hay informacion comercial relevante.',
                      ),
                      onChanged: _saving
                          ? null
                          : (value) => _apply(
                                () => NotificationPreferencesService.instance
                                    .setEnabled(value),
                              ),
                    ),
                    ListTile(
                      leading: const Icon(
                        Icons.notifications_active_outlined,
                        color: AppTheme.info,
                      ),
                      title: const Text('Permiso del sistema'),
                      subtitle: const Text(
                        'Solicita el permiso de Android/iOS si todavia no se ha concedido.',
                      ),
                      trailing: FilledButton(
                        onPressed: _saving ? null : _requestPermission,
                        child: const Text('Solicitar'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                _appearanceSection(),
                const SizedBox(height: 12),
                _section(
                  title: 'Pedidos',
                  children: [
                    _categorySwitch(settings, AppNotificationCategory.orders),
                    ListTile(
                      leading: const Icon(
                        Icons.schedule_rounded,
                        color: AppTheme.warning,
                      ),
                      title: const Text('Recordatorio de pedidos'),
                      subtitle: const Text(
                        'Se reprograma en serie mientras existan borradores o pendientes.',
                      ),
                      trailing: DropdownButton<int>(
                        value: settings.orderReminderIntervalMinutes,
                        dropdownColor: AppTheme.raisedSurface,
                        items: const [
                          DropdownMenuItem(value: 30, child: Text('30 min')),
                          DropdownMenuItem(value: 60, child: Text('1 h')),
                          DropdownMenuItem(value: 120, child: Text('2 h')),
                        ],
                        onChanged: _saving
                            ? null
                            : (value) {
                                if (value == null) return;
                                _apply(
                                  () => NotificationPreferencesService.instance
                                      .setOrderReminderInterval(value),
                                );
                              },
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                _section(
                  title: 'Alertas comerciales',
                  children: [
                    _categorySwitch(settings, AppNotificationCategory.clients),
                    _categorySwitch(settings, AppNotificationCategory.invoices),
                    _categorySwitch(
                      settings,
                      AppNotificationCategory.commissions,
                    ),
                    _categorySwitch(
                      settings,
                      AppNotificationCategory.objectives,
                    ),
                    _categorySwitch(
                      settings,
                      AppNotificationCategory.dailyPace,
                    ),
                    _categorySwitch(
                      settings,
                      AppNotificationCategory.monthlyGoals,
                    ),
                    _categorySwitch(settings, AppNotificationCategory.glacius),
                    _categorySwitch(settings, AppNotificationCategory.rutero),
                    _categorySwitch(settings, AppNotificationCategory.bolsa),
                    _categorySwitch(
                      settings,
                      AppNotificationCategory.dailySummary,
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                _section(
                  title: 'Reparto',
                  children: [
                    _categorySwitch(
                      settings,
                      AppNotificationCategory.deliveries,
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                _section(
                  title: 'Pausar avisos',
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(12),
                      child: Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          _pauseChip(
                            '1 h',
                            () => _snoozeAll(const Duration(hours: 1)),
                          ),
                          _pauseChip(
                            '2 h',
                            () => _snoozeAll(const Duration(hours: 2)),
                          ),
                          _pauseChip('Hoy no', _snoozeUntilTomorrow),
                          _pauseChip(
                            'Reactivar',
                            () => _apply(
                              NotificationPreferencesService
                                  .instance.clearSnooze,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (settings.snoozedUntil.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                        child: Text(
                          _snoozeSummary(settings),
                          style: TextStyle(
                            color: AppTheme.textSecondary,
                            fontSize: 12,
                          ),
                        ),
                      ),
                  ],
                ),
              ],
            ),
    );
  }

  Widget _appearanceSection() {
    final isDarkMode = ref.watch(
      themeProvider.select((provider) => provider.isDarkMode),
    );
    return _section(
      title: 'Apariencia',
      children: [
        ListTile(
          leading: Icon(
            isDarkMode ? Icons.dark_mode_outlined : Icons.light_mode_outlined,
            color: Theme.of(context).colorScheme.primary,
          ),
          title: const Text('Tema de la aplicación'),
          subtitle: Text(isDarkMode ? 'Oscuro' : 'Claro'),
          trailing: Semantics(
            container: true,
            button: true,
            toggled: isDarkMode,
            label: 'Selector de tema',
            value: isDarkMode ? 'Oscuro' : 'Claro',
            hint: 'Alterna entre modo claro y modo oscuro',
            child: SegmentedButton<bool>(
              key: const ValueKey<String>('theme-mode-selector'),
              segments: const [
                ButtonSegment<bool>(
                  value: false,
                  icon: Icon(Icons.light_mode_outlined),
                  label: Text('Claro'),
                ),
                ButtonSegment<bool>(
                  value: true,
                  icon: Icon(Icons.dark_mode_outlined),
                  label: Text('Oscuro'),
                ),
              ],
              selected: {isDarkMode},
              showSelectedIcon: false,
              onSelectionChanged: _saving
                  ? null
                  : (selection) {
                      if (selection.isEmpty) return;
                      unawaited(_changeTheme(selection.first));
                    },
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _changeTheme(bool isDark) async {
    setState(() => _saving = true);
    try {
      await ref.read(themeProvider.notifier).setTheme(isDark);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('No se pudo guardar el tema: $error')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _section({
    required String title,
    required List<Widget> children,
  }) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: AppTheme.raisedSurface,
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
            child: Text(
              title,
              style: TextStyle(
                color: AppTheme.textPrimary,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          ...children,
        ],
      ),
    );
  }

  Widget _categorySwitch(
    NotificationPreferences settings,
    AppNotificationCategory category,
  ) {
    return SwitchListTile.adaptive(
      value: settings.categoryEnabled[category.key] ?? true,
      activeColor: AppTheme.info,
      title: Text(category.label),
      onChanged: _saving
          ? null
          : (value) => _apply(
                () => NotificationPreferencesService.instance
                    .setCategoryEnabled(category, value),
              ),
    );
  }

  Widget _pauseChip(String label, VoidCallback onPressed) {
    return ActionChip(
      label: Text(label),
      avatar: const Icon(Icons.pause_circle_outline_rounded, size: 18),
      onPressed: _saving ? null : onPressed,
      backgroundColor: AppTheme.softPanel,
      side: BorderSide(color: AppTheme.borderColor),
    );
  }

  Future<void> _snoozeAll(Duration duration) {
    return _apply(
      () => NotificationPreferencesService.instance.snoozeAllUntil(
        DateTime.now().add(duration),
      ),
    );
  }

  Future<void> _snoozeUntilTomorrow() {
    final now = DateTime.now();
    return _apply(
      () => NotificationPreferencesService.instance.snoozeAllUntil(
        DateTime(now.year, now.month, now.day + 1, 8),
      ),
    );
  }

  String _snoozeSummary(NotificationPreferences settings) {
    final entries = settings.snoozedUntil.entries.toList()
      ..sort((a, b) => a.value.compareTo(b.value));
    return entries.map((entry) {
      final label = notificationCategoryFromKey(entry.key)?.label ?? 'Todo';
      final hour = entry.value.hour.toString().padLeft(2, '0');
      final minute = entry.value.minute.toString().padLeft(2, '0');
      return '$label pausado hasta $hour:$minute';
    }).join(' - ');
  }
}
