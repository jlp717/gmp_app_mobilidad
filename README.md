# GMP Sales App - Professional Sales Analytics

A **professional Flutter application** for commercial representatives with **real-time IBM DB2 data integration**, comprehensive analytics, and modern Material 3 UI.

## 📋 Table of Contents
- [Features](#-features)
- [Architecture](#-architecture)
- [Requirements](#-requirements)
- [Quick Start](#-quick-start)
- [API Endpoints](#-api-endpoints)
- [Environment Configuration](#-environment-configuration)
- [Project Structure](#-project-structure)
- [Testing](#-testing)
- [Deployment](#-deployment)

---

## ✨ Features

### Dashboard
- **KPI Cards**: Real-time sales, margin, orders, and boxes
- **Sales Evolution Chart**: 12-month trend visualization with fl_chart
- **Top Clients/Products**: Ranked by sales with real names from DB2
- **Year-over-Year Comparison**: Growth metrics

### Clients Module
- **Searchable List**: Debounced search with real-time filtering
- **Client Detail Page**: 
  - Contact information and location
  - Sales history with trends
  - Products purchased (with real descriptions from ART table)
  - Payment status (pagado/pendiente from CVC table)
- **Client Comparison**: Compare multiple clients side-by-side
- **Export Data**: Export client reports as structured data

### Rutero (Route Planner)
- **Calendar View**: Daily activities grouped by date
- **Visit Details**: Client info, sales amount, margin per visit
- **Month Navigation**: Navigate through historical data (2023+)

### Analytics
- **Trend Predictions**: 3-month sales forecast using linear regression
- **Margin Analysis**: Monthly margins and by product family
- **Top Performers**: Products and clients ranked by sales

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────┐
│                   Flutter App                        │
│  ─────────────────────────────────────────────────   │
│  Screens: Dashboard │ Clients │ Rutero │ Analytics  │
│                         ↕                            │
│  State: Provider (AuthProvider, DashboardProvider)   │
│                         ↕                            │
│  HTTP: ApiClient (Dio) with error handling           │
└─────────────────────────┬────────────────────────────┘
                          │ REST API (JSON)
┌─────────────────────────▼────────────────────────────┐
│           Node.js Backend (Express.js)               │
│  ─────────────────────────────────────────────────   │
│  • Winston logging (console + file)                  │
│  • Rate limiting (500 req/15min)                     │
│  • 17 REST endpoints                                 │
│  • ODBC connection pool                              │
└─────────────────────────┬────────────────────────────┘
                          │ ODBC
┌─────────────────────────▼────────────────────────────┐
│              IBM DB2 Database (DSEDAC)               │
│  ─────────────────────────────────────────────────   │
│  Tables: CLI, LINDTO, ART, CVC, VDC, RUT, APPUSUARIOS│
│  Date Range: 2023-01-01 to current date              │
└──────────────────────────────────────────────────────┘
```

---

## 📦 Requirements

### Backend
- Node.js 18+
- IBM DB2 ODBC Driver
- Access to GMP ODBC DSN

### Flutter App
- Flutter SDK 3.10+
- Android SDK (minSdkVersion 21)
- iOS 12+ (optional)

---

## 🚀 Quick Start

### 1. Backend Setup

```bash
# Navigate to backend folder
cd backend

# Install dependencies
npm install

# Copy environment example (optional)
cp .env.example .env

# Start server
node server.js

# Server runs on http://localhost:3333
# Verify: curl http://localhost:3333/api/health
```

### 2. Flutter App Setup

```bash
# Install Flutter dependencies
flutter pub get

# Update API URL (if needed)
# Edit: lib/core/api/api_config.dart
# Change baseUrl to your server IP

# Run on device/emulator
flutter run

# Build release APK
flutter build apk --release
```

### 3. Login Credentials
Use your APPUSUARIOS credentials from DB2:
- **Username**: Your CODIGOUSUARIO (e.g., `GOYO`)
- **Password**: Your PASSWORD (e.g., `19`)

---

## 🔌 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | POST | User authentication |
| `/api/health` | GET | Server health check |
| `/api/dashboard/metrics` | GET | KPIs (sales, margin, orders) |
| `/api/dashboard/sales-evolution` | GET | Monthly sales data (12 months) |
| `/api/dashboard/yoy-comparison` | GET | Year-over-year comparison |
| `/api/dashboard/recent-sales` | GET | Latest sales transactions |
| `/api/clients` | GET | Client list with search |
| `/api/clients/:code` | GET | Client detail with history |
| `/api/clients/compare` | GET | Compare multiple clients |
| `/api/router/calendar` | GET | Daily activities for rutero |
| `/api/analytics/top-products` | GET | Best-selling products |
| `/api/analytics/top-clients` | GET | Top clients by sales |
| `/api/analytics/margins` | GET | Margin analysis by month/family |
| `/api/analytics/trends` | GET | Sales predictions (3 months) |
| `/api/products` | GET | Product catalog from ART |
| `/api/vendedores` | GET | Sales team list |
| `/api/export/client-report` | GET | Client data for PDF export |

### Query Parameters
Most endpoints support:
- `vendedorCodes`: Comma-separated list (e.g., `095,096`) or `ALL`
- `year`: Year filter (default: current year)
- `month`: Month filter (default: current month)
- `limit`: Pagination limit (default: 50)

---

## ⚙ Environment Configuration

### Backend (.env)
```env
# Server
PORT=3333
NODE_ENV=production

# Database (ODBC)
DB_DSN=GMP
DB_UID=JAVIER
DB_PWD=JAVIER

# Security
JWT_SECRET=your-secret-key

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=500
```

### Flutter (api_config.dart)
```dart
// For Android emulator
static const String baseUrl = 'http://10.0.2.2:3333/api';

// For physical device (use your PC's IP)
static const String baseUrl = 'http://192.168.1.XXX:3333/api';
```

---

## 📁 Project Structure

```
gmp_app_mobilidad/
├── backend/
│   ├── server.js          # Express server (17 endpoints)
│   ├── package.json       # Node.js dependencies
│   └── .env.example       # Environment template
│
├── lib/
│   ├── main.dart          # App entry point
│   ├── core/
│   │   ├── api/           # ApiClient, ApiConfig
│   │   ├── models/        # dashboard_models.dart, user.dart
│   │   ├── providers/     # auth_provider, dashboard_provider
│   │   ├── router/        # go_router configuration
│   │   └── theme/         # app_theme.dart
│   │
│   └── features/
│       ├── analytics/     # Analytics page
│       ├── auth/          # Login page
│       ├── clients/       # Client list + detail pages
│       ├── dashboard/     # Dashboard + main shell
│       └── rutero/        # Rutero calendar page
│
├── test/
│   ├── api/               # API config tests
│   ├── models/            # Model unit tests (15 tests)
│   └── widget_test.dart   # Widget smoke tests
│
└── pubspec.yaml           # Flutter dependencies
```

---

## 🧪 Testing

```bash
# Run all tests
flutter test

# Run specific test file
flutter test test/models/dashboard_models_test.dart

# Run with coverage
flutter test --coverage
```

### Test Coverage
- **24 tests** covering:
  - Dashboard models (DashboardMetrics, RecentSale, etc.)
  - API configuration
  - Basic widget smoke tests

---

## 📱 Deployment

### Android APK

```bash
# Debug build
flutter build apk --debug

# Release build (requires keystore)
flutter build apk --release

# Output: build/app/outputs/flutter-apk/app-release.apk
```

### Production Checklist
1. ✅ Update `baseUrl` in `api_config.dart` to production server
2. ✅ Configure proper CORS origins in backend
3. ✅ Set `NODE_ENV=production` in backend
4. ✅ Use HTTPS in production
5. ✅ Configure proper JWT secrets

---

## 📊 Database Tables Used

| Table | Purpose |
|-------|---------|
| `APPUSUARIOS` | User authentication |
| `CLI` | Client master data |
| `LINDTO` | Sales line items (main data source) |
| `ART` | Product catalog with descriptions |
| `CVC` | Payment status (cobrado/pendiente) |
| `VDC` | Sales representative data |
| `RUT` | Route assignments |

---

## 📄 License

Proprietary - GMP Internal Use Only

---

## 🤝 Support

For issues or questions, contact the development team.
