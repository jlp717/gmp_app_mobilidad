/// REPARTIDOR PANEL PAGE v1.0
/// Dashboard adaptado para reparto con métricas de entregas, cobros y resumen diario
/// Equivalente al Panel de Ventas pero enfocado a operativa de reparto

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../data/repartidor_data_service.dart';

class RepartidorPanelPage extends StatefulWidget {
  final String repartidorId;

  const RepartidorPanelPage({super.key, required this.repartidorId});

  @override
  State<RepartidorPanelPage> createState() => _RepartidorPanelPageState();
}

class _RepartidorPanelPageState extends State<RepartidorPanelPage> {
  bool _isLoading = true;
  String? _error;

  // Data
  Map<String, dynamic> _deliverySummary = {};
  List<Map<String, dynamic>> _dailyData = [];
  CollectionsSummary? _collectionsSummary;

  int _selectedYear = DateTime.now().year;
  int _selectedMonth = DateTime.now().month;

  @override
  void initState() {
    super.initState();
    _loadAllData();
  }

  Future<void> _loadAllData() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final results = await Future.wait([
        RepartidorDataService.getDeliverySummary(
          repartidorId: widget.repartidorId,
          year: _selectedYear,
          month: _selectedMonth,
        ),
        RepartidorDataService.getCollectionsSummary(
          repartidorId: widget.repartidorId,
          year: _selectedYear,
          month: _selectedMonth,
        ).catchError((_) => null),
      ]);

      final deliveryData = results[0] as Map<String, dynamic>;
      final collections = results[1];

      if (mounted) {
        setState(() {
          _deliverySummary = (deliveryData['summary'] as Map<String, dynamic>?) ?? {};
          _dailyData = ((deliveryData['daily'] as List?) ?? [])
              .map((d) => Map<String, dynamic>.from(d as Map))
              .toList();
          if (collections is CollectionsSummary) {
            _collectionsSummary = collections;
          }
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.backgroundColor,
      body: Column(
        children: [
          _buildHeader(),
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator(color: AppTheme.neonBlue))
                : _error != null
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.error_outline, color: AppTheme.error, size: 48),
                            const SizedBox(height: 12),
                            Text('Error: $_error', style: const TextStyle(color: AppTheme.textSecondary)),
                            const SizedBox(height: 12),
                            ElevatedButton(
                              onPressed: _loadAllData,
                              child: const Text('Reintentar'),
                            ),
                          ],
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: _loadAllData,
                        child: ListView(
                          padding: const EdgeInsets.all(16),
                          children: [
                            _buildKPICards(),
                            const SizedBox(height: 16),
                            if (_collectionsSummary != null) ...[
                              _buildCollectionsCard(),
                              const SizedBox(height: 16),
                            ],
                            _buildDailyChart(),
                            const SizedBox(height: 16),
                            _buildDailyTable(),
                          ],
                        ),
                      ),
          ),
        ],
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        border: Border(bottom: BorderSide(color: Colors.white.withOpacity(0.05))),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              gradient: LinearGradient(colors: [Colors.orange.withOpacity(0.3), Colors.deepOrange.withOpacity(0.2)]),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.dashboard, color: Colors.orange, size: 24),
          ),
          const SizedBox(width: 12),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Panel de Reparto', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
                Text('Resumen de entregas y cobros', style: TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
              ],
            ),
          ),
          // Month selector
          _buildMonthSelector(),
        ],
      ),
    );
  }

  Widget _buildMonthSelector() {
    final months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Year dropdown
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: AppTheme.neonBlue.withOpacity(0.1),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: AppTheme.neonBlue.withOpacity(0.3)),
          ),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<int>(
              value: _selectedYear,
              isDense: true,
              dropdownColor: AppTheme.surfaceColor,
              style: const TextStyle(color: AppTheme.neonBlue, fontSize: 13, fontWeight: FontWeight.bold),
              items: [
                for (int y = DateTime.now().year; y >= DateTime.now().year - 2; y--)
                  DropdownMenuItem(value: y, child: Text('$y')),
              ],
              onChanged: (v) {
                if (v != null) {
                  setState(() => _selectedYear = v);
                  _loadAllData();
                }
              },
            ),
          ),
        ),
        const SizedBox(width: 8),
        // Month dropdown
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: Colors.orange.withOpacity(0.1),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: Colors.orange.withOpacity(0.3)),
          ),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<int>(
              value: _selectedMonth,
              isDense: true,
              dropdownColor: AppTheme.surfaceColor,
              style: const TextStyle(color: Colors.orange, fontSize: 13, fontWeight: FontWeight.bold),
              items: [
                for (int m = 1; m <= 12; m++)
                  DropdownMenuItem(value: m, child: Text(months[m - 1])),
              ],
              onChanged: (v) {
                if (v != null) {
                  setState(() => _selectedMonth = v);
                  _loadAllData();
                }
              },
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildKPICards() {
    final total = _deliverySummary['totalAlbaranes'] ?? 0;
    final entregados = _deliverySummary['entregados'] ?? 0;
    final noEntregados = _deliverySummary['noEntregados'] ?? 0;
    final pendientes = _deliverySummary['pendientes'] ?? 0;
    final importe = (_deliverySummary['importeTotal'] ?? 0).toDouble();
    final pctEntrega = total > 0 ? (entregados / total * 100) : 0.0;

    return Column(
      children: [
        Row(
          children: [
            Expanded(child: _kpiCard('Total Albaranes', '$total', Icons.receipt_long, AppTheme.neonBlue)),
            const SizedBox(width: 12),
            Expanded(child: _kpiCard('Entregados', '$entregados', Icons.check_circle, AppTheme.neonGreen)),
            const SizedBox(width: 12),
            Expanded(child: _kpiCard('No Entregados', '$noEntregados', Icons.cancel, AppTheme.error)),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(child: _kpiCard('Pendientes', '$pendientes', Icons.pending, Colors.orange)),
            const SizedBox(width: 12),
            Expanded(child: _kpiCard('% Entrega', '${pctEntrega.toStringAsFixed(1)}%', Icons.pie_chart, AppTheme.neonPurple)),
            const SizedBox(width: 12),
            Expanded(child: _kpiCard('Importe Total', CurrencyFormatter.format(importe), Icons.euro, AppTheme.neonBlue)),
          ],
        ),
      ],
    );
  }

  Widget _kpiCard(String label, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withOpacity(0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color, size: 18),
              const SizedBox(width: 6),
              Expanded(
                child: Text(label, style: TextStyle(fontSize: 11, color: AppTheme.textSecondary), overflow: TextOverflow.ellipsis),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: color)),
        ],
      ),
    );
  }

  Widget _buildCollectionsCard() {
    final cs = _collectionsSummary!;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.neonGreen.withOpacity(0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.euro, color: AppTheme.neonGreen, size: 20),
              const SizedBox(width: 8),
              const Text('Cobros del Mes', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: cs.thresholdMet ? AppTheme.neonGreen.withOpacity(0.2) : Colors.orange.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  cs.thresholdMet ? 'OBJETIVO CUMPLIDO' : '${cs.overallPercentage.toStringAsFixed(1)}%',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: cs.thresholdMet ? AppTheme.neonGreen : Colors.orange,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          // Progress bar
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: LinearProgressIndicator(
              value: (cs.overallPercentage / 100).clamp(0.0, 1.0),
              minHeight: 10,
              backgroundColor: Colors.white.withOpacity(0.05),
              valueColor: AlwaysStoppedAnimation(cs.thresholdMet ? AppTheme.neonGreen : Colors.orange),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _miniStat('Cobrable', CurrencyFormatter.format(cs.totalCollectable)),
              _miniStat('Cobrado', CurrencyFormatter.format(cs.totalCollected)),
              _miniStat('Comisión', CurrencyFormatter.format(cs.totalCommission)),
              _miniStat('Clientes', '${cs.clientCount}'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _miniStat(String label, String value) {
    return Expanded(
      child: Column(
        children: [
          Text(value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
        ],
      ),
    );
  }

  Widget _buildDailyChart() {
    if (_dailyData.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: AppTheme.surfaceColor,
          borderRadius: BorderRadius.circular(14),
        ),
        child: const Center(
          child: Text('Sin datos de entregas para este período', style: TextStyle(color: AppTheme.textSecondary)),
        ),
      );
    }

    final maxTotal = _dailyData.fold<double>(0, (max, d) {
      final t = (d['total'] ?? 0).toDouble();
      return t > max ? t : max;
    });

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.bar_chart, color: AppTheme.neonBlue, size: 20),
              SizedBox(width: 8),
              Text('Entregas Diarias', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
            ],
          ),
          const SizedBox(height: 16),
          SizedBox(
            height: 140,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: _dailyData.map((d) {
                final total = (d['total'] ?? 0).toDouble();
                final delivered = (d['delivered'] ?? 0).toDouble();
                final height = maxTotal > 0 ? (total / maxTotal * 100) : 0.0;
                final deliveredHeight = maxTotal > 0 ? (delivered / maxTotal * 100) : 0.0;
                final day = d['day'] ?? 0;

                return Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 1),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        Text('${total.toInt()}', style: const TextStyle(fontSize: 8, color: AppTheme.textSecondary)),
                        const SizedBox(height: 2),
                        Stack(
                          alignment: Alignment.bottomCenter,
                          children: [
                            Container(
                              height: height.clamp(2.0, 100.0),
                              decoration: BoxDecoration(
                                color: AppTheme.neonBlue.withOpacity(0.2),
                                borderRadius: BorderRadius.circular(3),
                              ),
                            ),
                            Container(
                              height: deliveredHeight.clamp(0.0, 100.0),
                              decoration: BoxDecoration(
                                color: AppTheme.neonGreen.withOpacity(0.7),
                                borderRadius: BorderRadius.circular(3),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text('$day', style: const TextStyle(fontSize: 9, color: AppTheme.textSecondary)),
                      ],
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(width: 10, height: 10, decoration: BoxDecoration(color: AppTheme.neonBlue.withOpacity(0.2), borderRadius: BorderRadius.circular(2))),
              const SizedBox(width: 4),
              const Text('Total', style: TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
              const SizedBox(width: 16),
              Container(width: 10, height: 10, decoration: BoxDecoration(color: AppTheme.neonGreen.withOpacity(0.7), borderRadius: BorderRadius.circular(2))),
              const SizedBox(width: 4),
              const Text('Entregados', style: TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildDailyTable() {
    if (_dailyData.isEmpty) return const SizedBox.shrink();

    return Container(
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 14, 16, 8),
            child: Row(
              children: [
                Icon(Icons.table_chart, color: AppTheme.neonPurple, size: 20),
                SizedBox(width: 8),
                Text('Detalle Diario', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: AppTheme.textPrimary)),
              ],
            ),
          ),
          // Table header
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.03),
            ),
            child: const Row(
              children: [
                SizedBox(width: 40, child: Text('Día', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.textSecondary))),
                Expanded(child: Text('Total', textAlign: TextAlign.center, style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.textSecondary))),
                Expanded(child: Text('Entreg.', textAlign: TextAlign.center, style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.neonGreen))),
                Expanded(child: Text('No Ent.', textAlign: TextAlign.center, style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFFE53935)))),
                Expanded(child: Text('Pend.', textAlign: TextAlign.center, style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.orange))),
                SizedBox(width: 80, child: Text('Importe', textAlign: TextAlign.right, style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.textSecondary))),
              ],
            ),
          ),
          ..._dailyData.map((d) {
            final day = d['day'] ?? 0;
            final total = d['total'] ?? 0;
            final delivered = d['delivered'] ?? 0;
            final notDel = d['notDelivered'] ?? 0;
            final pending = d['pending'] ?? 0;
            final amount = (d['amount'] ?? 0).toDouble();

            return Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              decoration: BoxDecoration(
                border: Border(bottom: BorderSide(color: Colors.white.withOpacity(0.03))),
              ),
              child: Row(
                children: [
                  SizedBox(width: 40, child: Text('$day', style: const TextStyle(fontSize: 12, color: AppTheme.textPrimary, fontWeight: FontWeight.w600))),
                  Expanded(child: Text('$total', textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, color: AppTheme.textPrimary))),
                  Expanded(child: Text('$delivered', textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, color: AppTheme.neonGreen, fontWeight: FontWeight.bold))),
                  Expanded(child: Text('$notDel', textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: notDel > 0 ? AppTheme.error : AppTheme.textSecondary))),
                  Expanded(child: Text('$pending', textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: pending > 0 ? Colors.orange : AppTheme.textSecondary))),
                  SizedBox(width: 80, child: Text(CurrencyFormatter.format(amount), textAlign: TextAlign.right, style: const TextStyle(fontSize: 12, color: AppTheme.textPrimary))),
                ],
              ),
            );
          }),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}
