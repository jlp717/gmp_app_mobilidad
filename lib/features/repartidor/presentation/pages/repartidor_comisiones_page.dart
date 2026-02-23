/// REPARTIDOR COMISIONES PAGE
/// Pestaña de comisiones con umbral 30% y 4 tramos
/// Dashboard, desglose por cliente, barras de progreso

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/widgets/smart_sync_header.dart'; // Import Sync Header
import '../../../../core/utils/currency_formatter.dart';
import '../../../../core/widgets/error_state_widget.dart';
import '../../data/repartidor_data_service.dart';

/// Página de comisiones para repartidores
/// Muestra el progreso hacia el umbral del 30% y las comisiones por tramos
class RepartidorComisionesPage extends StatefulWidget {
  final String repartidorId;

  const RepartidorComisionesPage({
    super.key,
    required this.repartidorId,
  });

  @override
  State<RepartidorComisionesPage> createState() => _RepartidorComisionesPageState();
}

class _RepartidorComisionesPageState extends State<RepartidorComisionesPage> {
  bool _isLoading = true;
  String? _error;
  DateTime? _lastFetchTime;
  
  // Data from API
  double _totalCollectable = 0;
  double _totalCollected = 0;
  double _totalCommission = 0;
  double _overallPercentage = 0;
  bool _thresholdMet = false;
  List<ClientCommissionData> _clientData = [];
  List<DailyAccumulated> _dailyData = [];

  // Filters
  int _selectedYear = DateTime.now().year;
  int _selectedMonth = DateTime.now().month;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      // Fetch real data from backend API
      final summary = await RepartidorDataService.getCollectionsSummary(
        repartidorId: widget.repartidorId,
        year: _selectedYear,
        month: _selectedMonth,
      );
      
      // Map API response to local models with commission calculation
      _totalCollectable = summary.totalCollectable;
      _totalCollected = summary.totalCollected;
      _totalCommission = summary.totalCommission;
      _overallPercentage = summary.overallPercentage;
      _thresholdMet = summary.thresholdMet;
      
      // Map clients from API response
      _clientData = summary.clients.map((c) {
        final client = ClientCommissionData(
          clientId: c.clientId,
          clientName: c.clientName,
          collectable: c.collectable,
          collected: c.collected,
          paymentType: c.paymentType,
        );
        
        // Calculate commission result for UI display
        client.commissionResult = CommissionResult(
          collectable: c.collectable,
          collected: c.collected,
          percentageCollected: c.percentage,
          thresholdMet: c.thresholdMet,
          thresholdProgress: c.thresholdProgress,
          currentTier: c.tier,
          commissionEarned: c.commission,
          tierLabel: c.tier > 0 ? 'Franja ${c.tier}' : '',
        );
        
        return client;
      }).toList();

      // Fetch daily data
      final daily = await RepartidorDataService.getDailyCollections(
        repartidorId: widget.repartidorId,
        year: _selectedYear,
        month: _selectedMonth,
      );
      
      _dailyData = daily.map((d) => DailyAccumulated(
        date: DateTime.parse(d.date),
        collectable: d.collectable,
        collected: d.collected,
      )).toList();

      _lastFetchTime = DateTime.now();
      
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading && _clientData.isEmpty) { // Show loading only if no data
      return const Scaffold(
        backgroundColor: AppTheme.darkBase,
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              CircularProgressIndicator(color: AppTheme.neonGreen),
              SizedBox(height: 16),
              Text('Calculando comisiones...', style: TextStyle(color: AppTheme.textSecondary)),
            ],
          ),
        ),
      );
    }

    if (_error != null && _clientData.isEmpty) {
      return Scaffold(
        backgroundColor: AppTheme.darkBase,
        body: ErrorStateWidget(
          message: _error!,
          onRetry: _loadData,
        ),
      );
    }

    final overallPct = _totalCollectable > 0 ? (_totalCollected / _totalCollectable) * 100 : 0.0;
    final thresholdProgress = (overallPct / 30).clamp(0.0, 1.0);

    return Scaffold(
      backgroundColor: AppTheme.darkBase,
      body: Column(
        children: [
          // Header
           SmartSyncHeader(
            title: 'Comisiones',
            subtitle: DateFormat('MMMM yyyy', 'es').format(DateTime(_selectedYear, _selectedMonth)),
            lastSync: _lastFetchTime ?? DateTime.now(),
            isLoading: _isLoading,
            onSync: _loadData,
            onMonthTap: _showMonthYearPicker, // Use month picker feature
          ),
          
          // Custom Commission Progress Header
          _buildCommissionProgress(overallPct, thresholdProgress),

          // Summary Cards
          _buildSummaryCards(),
          
          // Content
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Threshold explanation
                  _buildThresholdExplanation(overallPct),
                  
                  const SizedBox(height: 20),
                  
                  // Client breakdown
                  _buildClientBreakdown(),
                  
                  const SizedBox(height: 20),
                  
                  // Daily accumulated table
                  _buildDailyTable(),
                ],
              ),
            ),
          ),
        ],
      ),
      // FAB REMOVED
    );
  }

  Widget _buildCommissionProgress(double overallPct, double thresholdProgress) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        border: Border(bottom: BorderSide(color: Colors.white.withOpacity(0.05))),
      ),
      child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Progreso hacia Umbral 30%',
                    style: TextStyle(color: AppTheme.textSecondary, fontSize: Responsive.isSmall(context) ? 11 : 12),
                  ),
                  Text(
                    '${overallPct.toStringAsFixed(1)}% cobrado',
                    style: TextStyle(
                      color: overallPct >= 30 ? AppTheme.success : Colors.orange,
                      fontWeight: FontWeight.bold,
                      fontSize: Responsive.isSmall(context) ? 11 : 12,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: LinearProgressIndicator(
                  value: thresholdProgress,
                  backgroundColor: Colors.white.withOpacity(0.1),
                  valueColor: AlwaysStoppedAnimation<Color>(
                    overallPct >= 30 ? AppTheme.success : Colors.orange,
                  ),
                  minHeight: 10,
                ),
              ),
              if (overallPct >= 30)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Row(
                    children: [
                      Icon(Icons.check_circle, color: AppTheme.success, size: 14),
                      const SizedBox(width: 4),
                      Text(
                        '¡Umbral alcanzado! Las comisiones aplican.',
                        style: TextStyle(color: AppTheme.success, fontSize: 11),
                      ),
                    ],
                  ),
                ),
            ],
      ),
    );
  }

  Widget _buildSummaryCards() {
    return Container(
      padding: const EdgeInsets.all(12),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          // Total Cobrable
          SizedBox(
            width: Responsive.isSmall(context) ? (MediaQuery.of(context).size.width - 32) / 2 : 120,
            child: _buildSummaryCard(
              icon: Icons.account_balance_wallet,
              label: 'Cobrable',
              value: CurrencyFormatter.format(_totalCollectable),
              color: AppTheme.neonBlue,
            ),
          ),
          // Total Cobrado
          SizedBox(
            width: Responsive.isSmall(context) ? (MediaQuery.of(context).size.width - 32) / 2 : 120,
            child: _buildSummaryCard(
              icon: Icons.payments,
              label: 'Cobrado',
              value: CurrencyFormatter.format(_totalCollected),
              color: AppTheme.neonPurple,
            ),
          ),
          // Comisión Ganada
          SizedBox(
            width: Responsive.isSmall(context) ? (MediaQuery.of(context).size.width - 24) : 150,
            child: _buildSummaryCard(
              icon: Icons.emoji_events,
              label: 'Comisión Ganada',
              value: CurrencyFormatter.format(_totalCommission),
              color: AppTheme.neonGreen,
              isHighlighted: true,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSummaryCard({
    required IconData icon,
    required String label,
    required String value,
    required Color color,
    bool isHighlighted = false,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        gradient: isHighlighted
            ? LinearGradient(colors: [color.withOpacity(0.2), color.withOpacity(0.1)])
            : null,
        color: isHighlighted ? null : AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color, size: 18),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(fontSize: 10, color: color.withOpacity(0.8)),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            value,
            style: TextStyle(
              fontSize: isHighlighted ? (Responsive.isSmall(context) ? 16 : 18) : (Responsive.isSmall(context) ? 14 : 16),
              fontWeight: FontWeight.bold,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildThresholdExplanation(double overallPct) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white.withOpacity(0.05)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.info_outline, color: AppTheme.neonBlue, size: 18),
              const SizedBox(width: 8),
              const Text(
                'Cómo funcionan las comisiones',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  color: AppTheme.textPrimary,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          _buildTierRow('Umbral', '≥30% cobrado', 'Requisito mínimo', overallPct >= 30),
          const SizedBox(height: 8),
          const Divider(color: Colors.white10),
          const SizedBox(height: 8),
          _buildTierRow('Franja 1', '100-103%', '1.0%', overallPct >= 100 && overallPct < 103),
          _buildTierRow('Franja 2', '103-106%', '1.3%', overallPct >= 103 && overallPct < 106),
          _buildTierRow('Franja 3', '106-110%', '1.6%', overallPct >= 106 && overallPct < 110),
          _buildTierRow('Franja 4', '>110%', '2.0%', overallPct >= 110),
        ],
      ),
    );
  }

  Widget _buildTierRow(String tier, String range, String rate, bool isActive) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
      decoration: BoxDecoration(
        color: isActive ? AppTheme.neonGreen.withOpacity(0.1) : Colors.transparent,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        children: [
          Icon(
            isActive ? Icons.check_circle : Icons.radio_button_unchecked,
            size: 16,
            color: isActive ? AppTheme.neonGreen : AppTheme.textSecondary,
          ),
          const SizedBox(width: 8),
          Text(tier, style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: isActive ? AppTheme.neonGreen : AppTheme.textSecondary,
          )),
          const SizedBox(width: 12),
          Text(range, style: TextStyle(
            fontSize: 11,
            color: isActive ? AppTheme.textPrimary : AppTheme.textSecondary,
          )),
          const Spacer(),
          Text(rate, style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.bold,
            color: isActive ? AppTheme.neonGreen : AppTheme.textSecondary,
          )),
        ],
      ),
    );
  }

  Widget _buildClientBreakdown() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Desglose por Cliente',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
        ),
        const SizedBox(height: 12),
        ..._clientData.map((client) => _buildClientCard(client)),
      ],
    );
  }

  Widget _buildClientCard(ClientCommissionData client) {
    final result = client.commissionResult ?? CommissionResult.empty();
    final thresholdProgress = result.thresholdProgress;
    final pct = result.percentageCollected;
    final isThresholdMet = result.thresholdMet;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: isThresholdMet
              ? AppTheme.success.withOpacity(0.3)
              : Colors.orange.withOpacity(0.3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: AppTheme.neonBlue.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  client.clientId,
                  style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: AppTheme.neonBlue),
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: Colors.purple.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  client.paymentType,
                  style: const TextStyle(fontSize: 9, color: Colors.purpleAccent),
                ),
              ),
              const Spacer(),
              Text(
                isThresholdMet ? '✓ Umbral OK' : '⚠ Sin umbral',
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  color: isThresholdMet ? AppTheme.success : Colors.orange,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            client.clientName,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
          ),
          const SizedBox(height: 10),
          
          // Progress bar
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Progreso: ${pct.toStringAsFixed(1)}%',
                      style: TextStyle(fontSize: 10, color: AppTheme.textSecondary),
                    ),
                    const SizedBox(height: 4),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(
                        value: (pct / 100).clamp(0.0, 1.5),
                        backgroundColor: Colors.white.withOpacity(0.1),
                        valueColor: AlwaysStoppedAnimation<Color>(
                          isThresholdMet ? AppTheme.success : Colors.orange,
                        ),
                        minHeight: 8,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    'Comisión',
                    style: TextStyle(fontSize: 9, color: AppTheme.textSecondary),
                  ),
                  Text(
                    CurrencyFormatter.format(result.commissionEarned),
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: result.commissionEarned > 0 ? AppTheme.neonGreen : AppTheme.textSecondary,
                    ),
                  ),
                ],
              ),
            ],
          ),
          
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Cobrable: ${CurrencyFormatter.format(client.collectable)}',
                style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
              ),
              Text(
                'Cobrado: ${CurrencyFormatter.format(client.collected)}',
                style: TextStyle(fontSize: 11, color: AppTheme.textSecondary),
              ),
            ],
          ),
          
          if (result.currentTier > 0)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                result.tierLabel,
                style: TextStyle(fontSize: 10, color: AppTheme.neonGreen, fontStyle: FontStyle.italic),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildDailyTable() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Acumulado Diario',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: AppTheme.textPrimary),
        ),
        const SizedBox(height: 12),
        Container(
          decoration: BoxDecoration(
            color: AppTheme.surfaceColor,
            borderRadius: BorderRadius.circular(12),
          ),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              columnSpacing: 20,
              headingRowColor: WidgetStateProperty.all(AppTheme.darkBase),
              columns: const [
                DataColumn(label: Text('Fecha', style: TextStyle(color: AppTheme.textSecondary, fontSize: 11))),
                DataColumn(label: Text('Cobrable', style: TextStyle(color: AppTheme.textSecondary, fontSize: 11))),
                DataColumn(label: Text('Cobrado', style: TextStyle(color: AppTheme.textSecondary, fontSize: 11))),
                DataColumn(label: Text('%', style: TextStyle(color: AppTheme.textSecondary, fontSize: 11))),
              ],
              rows: _dailyData.map((day) {
                final pct = day.collectable > 0 ? (day.collected / day.collectable) * 100 : 0;
                return DataRow(cells: [
                  DataCell(Text(DateFormat('dd/MM').format(day.date), style: const TextStyle(color: AppTheme.textPrimary, fontSize: 12))),
                  DataCell(Text(CurrencyFormatter.format(day.collectable), style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12))),
                  DataCell(Text(CurrencyFormatter.format(day.collected), style: const TextStyle(color: AppTheme.neonBlue, fontSize: 12))),
                  DataCell(Text(
                    '${pct.toStringAsFixed(1)}%',
                    style: TextStyle(
                      color: pct >= 30 ? AppTheme.success : Colors.orange,
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                  )),
                ]);
              }).toList(),
            ),
          ),
        ),
      ],
    );
  }

  void _showMonthYearPicker() {
    final now = DateTime.now();
    final months = List.generate(12, (i) => i + 1);
    final years = List.generate(5, (i) => now.year - 2 + i);

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        decoration: BoxDecoration(
          color: AppTheme.surfaceColor,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.3),
              blurRadius: 20,
              offset: const Offset(0, -5),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Handle
            Container(
              margin: const EdgeInsets.only(top: 12),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.2),
                borderRadius: BorderRadius.circular(2),
              ),
            ),

            // Title
            const Padding(
              padding: EdgeInsets.all(20),
              child: Text(
                'Seleccionar Período',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: AppTheme.textPrimary,
                ),
              ),
            ),

            // Year selector
            SizedBox(
              height: 50,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                itemCount: years.length,
                itemBuilder: (context, index) {
                  final year = years[index];
                  final isSelected = year == _selectedYear;
                  return GestureDetector(
                    onTap: () => setState(() => _selectedYear = year),
                    child: Container(
                      margin: const EdgeInsets.symmetric(horizontal: 6),
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                      decoration: BoxDecoration(
                        gradient: isSelected
                            ? LinearGradient(colors: [
                                AppTheme.neonGreen.withOpacity(0.2),
                                AppTheme.success.withOpacity(0.1),
                              ])
                            : null,
                        color: isSelected ? null : AppTheme.darkBase,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: isSelected ? AppTheme.neonGreen : Colors.transparent,
                        ),
                      ),
                      child: Text(
                        year.toString(),
                        style: TextStyle(
                          color: isSelected ? AppTheme.neonGreen : AppTheme.textSecondary,
                          fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),

            const SizedBox(height: 16),

            // Month grid
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 4,
                  childAspectRatio: 2,
                  crossAxisSpacing: 8,
                  mainAxisSpacing: 8,
                ),
                itemCount: months.length,
                itemBuilder: (context, index) {
                  final month = months[index];
                  final isSelected = month == _selectedMonth;
                  final isFuture = _selectedYear == now.year && month > now.month;
                  return GestureDetector(
                    onTap: isFuture
                        ? null
                        : () {
                            setState(() => _selectedMonth = month);
                            Navigator.pop(ctx);
                            _loadData();
                          },
                    child: Container(
                      decoration: BoxDecoration(
                        gradient: isSelected
                            ? LinearGradient(colors: [
                                AppTheme.neonGreen.withOpacity(0.3),
                                AppTheme.success.withOpacity(0.15),
                              ])
                            : null,
                        color: isSelected ? null : AppTheme.darkBase,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: isSelected
                              ? AppTheme.neonGreen
                              : Colors.transparent,
                        ),
                      ),
                      child: Center(
                        child: Text(
                          DateFormat('MMM', 'es').format(DateTime(_selectedYear, month)),
                          style: TextStyle(
                            color: isFuture
                                ? AppTheme.textSecondary.withOpacity(0.3)
                                : isSelected
                                    ? AppTheme.neonGreen
                                    : AppTheme.textSecondary,
                            fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                            fontSize: 13,
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),

            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}

/// Modelo de datos de comisión por cliente
class ClientCommissionData {
  final String clientId;
  final String clientName;
  final double collectable;
  final double collected;
  final String paymentType;
  CommissionResult? commissionResult;

  ClientCommissionData({
    required this.clientId,
    required this.clientName,
    required this.collectable,
    required this.collected,
    required this.paymentType,
    this.commissionResult,
  });
}

/// Modelo de acumulado diario
class DailyAccumulated {
  final DateTime date;
  final double collectable;
  final double collected;

  DailyAccumulated({
    required this.date,
    required this.collectable,
    required this.collected,
  });
}
