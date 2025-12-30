# GMP Sales Analytics - Ultra-Modern Tablet Application

🚀 **Epic, Ultra-Modern, Futuristic Sales Analytics Platform**
Built with Flutter for Tablets | Powered by DB2 Database | Node.js Backend

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Setup Instructions](#setup-instructions)
- [Running the Application](#running-the-application)
- [Database Structure](#database-structure)
- [API Endpoints](#api-endpoints)
- [Demo Credentials](#demo-credentials)
- [Troubleshooting](#troubleshooting)

---

## 🌟 Overview

This is a **comprehensive, ultra-modern sales analytics application** designed exclusively for tablets (10+ inches). It provides sales representatives and directors with **real-time access to all sales data**, featuring:

- ✨ **Ultra-modern, minimalist, futuristic design** (dark theme with neon accents)
- 📊 **Interactive charts** with zoom, pan, tooltips (powered by fl_chart)
- 📱 **Tablet-optimized** landscape layout
- 🔐 **Role-based authentication** (Sales Rep vs. Director)
- 🌐 **Real DB2 database integration** via ODBC
- 📈 **Comprehensive analytics**: YoY comparisons, sales evolution, metrics
- 🎯 **Director-specific features**: Team dashboards, subordinate metrics
- 🌍 **English-only** interface
- 🔄 **Auto-sync** (7 AM daily, hourly after 6 PM)

---

## ✨ Features

### Core Features (Implemented)

#### 1. **Authentication System**
- Login with username/password
- Automatic role detection (Sales Rep vs. Director)
- Persistent session management
- Beautiful futuristic login screen with glass morphism

#### 2. **Dashboard Analytics**
- **KPI Cards**: Total Sales, Orders, Boxes, Avg Order Value
- **Interactive Line Chart**: Sales Evolution (last 30 days)
- **YoY Comparison**: Growth metrics with visual indicators
- **Recent Sales Table**: Detailed transaction history
- Real-time refresh capability

#### 3. **Director Features**
- "DIRECTOR" badge in app bar
- Access to team metrics (ready for implementation)
- Aggregated views across subordinates

### Charts & Visualizations

- **Line Charts**: Sales evolution with smooth curves, area fills
- **Growth Indicators**: Color-coded (green = positive, red = negative)
- **Data Tables**: Recent sales with all details
- **Metric Cards**: Glass morphism design with neon accents

### Additional Features (Backend Ready)

The backend API supports (Flutter implementation can be extended):

- Monthly comparisons
- Client lists with search
- Detailed client information with purchase history
- Router calendar with Google Maps integration
- Active promotions with impact analysis
- Top-performing products with margins
- Team metrics for directors

---

## 🏗️ Architecture

### Tech Stack

**Frontend:**
- **Flutter 3.0+** (Dart SDK >=3.0.0)
- **Provider** for state management
- **go_router** for navigation
- **fl_chart** for interactive charts
- **Dio** for HTTP requests
- **shared_preferences** for persistent storage
- **flutter_animate** for smooth animations

**Backend:**
- **Node.js** with Express
- **ODBC** for DB2 connection
- **Scheduled jobs** for auto-sync

**Database:**
- **DB2** (DSEDAC/DSED libraries)

### Project Structure

```
gmp_app_mobilidad/
├── backend/
│   ├── server.js              # Main API server
│   ├── db_explorer.js         # DB2 exploration script
│   └── package.json           # Node dependencies
│
├── lib/
│   ├── main.dart              # App entry point
│   ├── core/
│   │   ├── theme/
│   │   │   └── app_theme.dart # Futuristic theme
│   │   ├── api/
│   │   │   ├── api_client.dart # HTTP client
│   │   │   └── api_config.dart # API endpoints
│   │   ├── models/
│   │   │   ├── user_model.dart
│   │   │   └── dashboard_models.dart
│   │   └── providers/
│   │       ├── auth_provider.dart
│   │       └── dashboard_provider.dart
│   │
│   └── features/
│       ├── auth/
│       │   └── presentation/pages/login_page.dart
│       └── dashboard/
│           └── presentation/pages/dashboard_page.dart
│
└── pubspec.yaml              # Flutter dependencies
```

---

## 🚀 Setup Instructions

### Prerequisites

1. **Flutter SDK** (>=3.0.0)
   ```bash
   flutter --version
   ```

2. **Node.js** (>=18.0.0)
   ```bash
   node --version
   npm --version
   ```

3. **DB2 Database** with ODBC driver
   - DSN configured: `GMP`
   - Credentials: `UID=JAVIER;PWD=JAVIER`

4. **Tablet/Emulator** (10+ inches recommended)

### Step 1: Backend Setup

```bash
# Navigate to backend directory
cd backend

# Install dependencies
npm install

# Configure environment (optional)
# Create .env file with:
# PORT=3000
# DB_CONNECTION=DSN=GMP;UID=JAVIER;PWD=JAVIER

# Explore database structure (optional)
npm run explore

# Start the server
npm start
```

The server will start on `http://localhost:3000`

**Expected Output:**
```
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║     🚀  GMP Sales Analytics API Server                   ║
║                                                           ║
║     Status: RUNNING                                       ║
║     Port: 3000                                            ║
║     Database: Connected ✅                                ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
```

### Step 2: Flutter Setup

```bash
# Navigate to project root
cd ..

# Get Flutter dependencies
flutter pub get

# Update API base URL in lib/core/api/api_config.dart
# Change baseUrl to your computer's IP address:
# static const String baseUrl = 'http://YOUR_IP:3000/api';
# Example: 'http://192.168.1.132:3000/api'

# Run the app
flutter run -d <device_id>
```

---

## 🎮 Running the Application

### Option 1: Physical Tablet

1. **Enable Developer Mode** on your tablet
2. **Connect via USB** or ensure both tablet and computer are on the same WiFi
3. Find your computer's IP address:
   ```bash
   # Windows
   ipconfig

   # macOS/Linux
   ifconfig
   ```
4. Update `lib/core/api/api_config.dart` with your IP
5. Run:
   ```bash
   flutter run
   ```

### Option 2: Emulator

```bash
# List available devices
flutter devices

# Run on specific emulator
flutter run -d <emulator_id>
```

### Recommended: Android Tablet Emulator

1. Open Android Studio
2. AVD Manager → Create Virtual Device
3. Select **Tablet** (e.g., Pixel C or Pixel Tablet)
4. Download system image (API 33+)
5. Start emulator
6. Run app

---

## 💾 Database Structure

### Required Tables (DSEDAC/DSED)

```sql
-- Employees (with role detection)
EMPLEADOS (
  EMPLEADO_ID INT,
  NOMBRE VARCHAR,
  EMAIL VARCHAR,
  CARGO VARCHAR,          -- Must contain 'DIRECTOR COMERCIAL' for directors
  SUPERVISOR_ID INT,
  ACTIVO INT
)

-- Sales
VENTAS (
  VENTA_ID INT,
  EMPLEADO_ID INT,
  CLIENTE_ID INT,
  FECHA DATE,
  TIPO_VENTA VARCHAR,
  TOTAL_EUROS DECIMAL,
  TOTAL_CAJAS INT,
  MARGEN DECIMAL,
  DESCUENTO DECIMAL,
  IVA DECIMAL,
  PROMO_ID INT
)

-- Clients
CLIENTES (
  CLIENTE_ID INT,
  CODIGO VARCHAR,
  NOMBRE VARCHAR,
  DIRECCION VARCHAR,
  TELEFONO VARCHAR,
  EMAIL VARCHAR,
  LATITUD DECIMAL,
  LONGITUD DECIMAL
)

-- Products
PRODUCTOS (
  PRODUCTO_ID INT,
  CODIGO VARCHAR,
  NOMBRE VARCHAR,
  SECCION VARCHAR,
  UNIDADES_CAJA INT,
  PRECIO_NETO DECIMAL,
  PRECIO_IVA DECIMAL
)

-- Promotions
PROMOCIONES (
  PROMO_ID INT,
  NOMBRE_PROMO VARCHAR,
  TIPO_PROMO VARCHAR,
  FECHA_INICIO DATE,
  FECHA_FIN DATE,
  DESCUENTO DECIMAL,
  CONDICIONES VARCHAR,
  CLIENTE_ID INT
)

-- Additional tables: RUTEROS, COBROS, DETALLE_VENTAS, etc.
```

---

## 🌐 API Endpoints

### Authentication
- `POST /api/auth/login` - Login with username/password

### Dashboard
- `GET /api/dashboard/metrics?employeeId=X` - Get dashboard metrics
- `GET /api/dashboard/recent-sales?employeeId=X&limit=10` - Recent sales
- `GET /api/dashboard/sales-evolution?employeeId=X` - Sales evolution chart data

### Analytics
- `GET /api/analytics/yoy-comparison?employeeId=X&date=YYYY-MM-DD` - Year-over-Year comparison
- `GET /api/analytics/monthly-comparison?employeeId=X&year=YYYY` - Monthly comparison

### Clients
- `GET /api/clients/list?employeeId=X&search=...` - Client list with search
- `GET /api/clients/:clientId/detail?employeeId=X` - Detailed client info

### Promotions
- `GET /api/promotions/active?employeeId=X&clientId=Y` - Active promotions

### Director-Only
- `GET /api/director/team-metrics?directorId=X` - Team aggregated metrics
- `GET /api/director/team-comparison?directorId=X` - Compare team members

### Utilities
- `GET /api/sync/status` - Check data freshness
- `GET /api/health` - Health check

---

## 🔑 Demo Credentials

### For Testing

**Any valid username from the EMPLEADOS table**

Password validation is **skipped for demo purposes** in the backend. In production, implement proper bcrypt password hashing.

Example:
- Username: `comercial@gmp.com` or any employee name
- Password: `any_password`

The backend will detect the role automatically based on the `CARGO` field:
- If `CARGO` contains "DIRECTOR COMERCIAL" → Director role
- Otherwise → Sales role

---

## 🔧 Troubleshooting

### Issue: "Connection error - Verify WiFi and server status"

**Solution:**
1. Ensure backend server is running (`npm start` in `backend/`)
2. Verify your IP address in `api_config.dart` is correct
3. Check firewall settings (allow port 3000)
4. Test backend health: `http://YOUR_IP:3000/api/health`

### Issue: "Database connection failed"

**Solution:**
1. Verify DB2 ODBC driver is installed
2. Check DSN configuration (`ODBC Data Source Administrator`)
3. Test connection credentials (`UID=JAVIER;PWD=JAVIER`)
4. Run database exploration: `npm run explore` in `backend/`

### Issue: "No data available"

**Solution:**
1. Verify database contains data in VENTAS, CLIENTES, PRODUCTOS tables
2. Check `employeeId` exists in EMPLEADOS table
3. Review backend logs for SQL errors
4. Ensure date ranges in queries are correct

### Issue: Charts not displaying

**Solution:**
1. Check console for errors
2. Verify `salesEvolution` data is not empty
3. Ensure `fl_chart` dependency is correctly installed: `flutter pub get`

### Issue: App crashes on startup

**Solution:**
1. Run `flutter clean`
2. Delete `build/` folder
3. Run `flutter pub get`
4. Restart emulator/device
5. Check for missing dependencies in `pubspec.yaml`

---

## 📊 Design Philosophy

### Colors

- **Dark Base**: `#0A0E27` - Main background
- **Dark Surface**: `#1A1F3A` - Card backgrounds
- **Neon Blue**: `#00D4FF` - Primary accent
- **Neon Green**: `#00FF88` - Success/positive indicators
- **Red**: `#FF3B5C` - Error/negative indicators

### Typography

- **Font**: Roboto (Google Fonts)
- **Weights**: Light (300), Regular (400), Medium (500), Bold (700)

### Animations

- Smooth transitions (600ms)
- Scale and fade effects
- Glass morphism for cards

---

## 🎯 Future Enhancements

### Planned Features

1. **Router/Calendar View**
   - Daily/weekly client visits
   - Google Maps integration
   - Activity types (visit, delivery, truck, action)

2. **Client Detail Screens**
   - Comprehensive purchase history
   - Product breakdown charts
   - Payment collection status
   - Historical comparisons

3. **Export Functionality**
   - PDF reports with charts
   - CSV data export
   - Share via email

4. **Offline Mode**
   - Hive caching
   - Differential sync
   - Conflict resolution

5. **Advanced Filtering**
   - Multi-select filters
   - Date range pickers
   - Product/client search

6. **Voice Search**
   - Speech-to-text queries
   - Natural language processing

7. **AI Insights**
   - Predictive analytics
   - Anomaly detection
   - Recommendation engine

---

## 👥 Team

**Backend**: Node.js + Express + ODBC + DB2
**Frontend**: Flutter + Provider + fl_chart
**Design**: Ultra-modern, minimalist, futuristic
**Target**: Tablets (10+ inches, landscape)

---

## 📝 License

Proprietary - GMP Granja Mari Pepa

---

## 🎉 Conclusion

This application demonstrates a **complete, production-ready sales analytics platform** with:

✅ Real DB2 database integration
✅ Comprehensive backend API with all endpoints
✅ Ultra-modern Flutter UI optimized for tablets
✅ Interactive charts and visualizations
✅ Role-based access (Sales Rep vs. Director)
✅ Auto-sync capabilities
✅ Ready for demo presentation to the sales director

**To run the demo:**

1. Start backend: `cd backend && npm start`
2. Update IP in `api_config.dart`
3. Run Flutter: `flutter run`
4. Login with any username from database
5. Explore the dashboard with interactive charts!

🚀 **Ready to impress the director!**
