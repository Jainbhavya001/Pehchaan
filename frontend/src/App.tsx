import React, { useState, useCallback } from 'react';
import { ScreenType, ScreeningRecord } from './types';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { I18nProvider } from './contexts/I18nContext';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { LoginView } from './components/LoginView';
import { CheckpointSelector } from './components/CheckpointSelector';
import { OverviewView } from './components/OverviewView';
import { NewScanView } from './components/NewScanView';
import { ScreeningReportView } from './components/ScreeningReportView';
import { AuditTrailView } from './components/AuditTrailView';
import { SystemHealthDocsView } from './components/SystemHealthDocsView';
import { AdminPortalView } from './components/AdminPortalView';
import { OfficerStatusView } from './components/OfficerStatusView';
import { SystemLogsView } from './components/SystemLogsView';
import { SecurityView } from './components/SecurityView';
import { ChangePasswordView } from './components/ChangePasswordView';
import { RemoteLocationSyncBar } from './components/RemoteLocationSyncBar';
import { MobileBottomNav } from './components/MobileBottomNav';
import { PrivacyPolicyView } from './components/PrivacyPolicyView';
import { TermsView } from './components/TermsView';
import { NotFoundView } from './components/NotFoundView';
import { CookieConsent } from './components/CookieConsent';
import {
  fetchScansFromNeon,
} from './services/neonSyncService';
import { trackPageView } from './services/analytics';

function AuthenticatedApp({ onNavigatePage }: { onNavigatePage: (p: PageRoute) => void }) {
  const { user, checkpoint, isAuthenticated, isLoading, isAdmin, hasRole, token } = useAuth();
  const [currentScreen, setCurrentScreen] = useState<ScreenType>('overview');
  const [records, setRecords] = useState<ScreeningRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<ScreeningRecord | null>(null);
  const [scansCount, setScansCount] = useState<number>(0);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [recordsLoaded, setRecordsLoaded] = useState(false);

  const loadNeonRecords = useCallback(async () => {
    if (!token) return;
    try {
      const serverRecords = await fetchScansFromNeon(token);
      setRecords(serverRecords);
      setScansCount(serverRecords.length);
      if (serverRecords[0] && !selectedRecord) {
        setSelectedRecord(serverRecords[0]);
      }
      setRecordsLoaded(true);
    } catch {
      setRecordsLoaded(true);
    }
  }, [token, selectedRecord]);

  React.useEffect(() => {
    if (isAuthenticated && checkpoint && !recordsLoaded) {
      loadNeonRecords();
    }
  }, [isAuthenticated, checkpoint, recordsLoaded, loadNeonRecords]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0c1017] flex items-center justify-center">
        <div className="text-[#8a94a6] text-sm">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) return <LoginView onNavigatePage={onNavigatePage} />;
  if (user?.mustChangePassword) return <ChangePasswordView />;
  if (!checkpoint) return <CheckpointSelector />;

  // The server has already analysed, hashed, stored and audited the scan.
  const handleAddRecord = (newRecord: ScreeningRecord) => {
    setRecords((prev) => [newRecord, ...prev.filter((r) => r.id !== newRecord.id)]);
    setSelectedRecord(newRecord);
    setScansCount((prev) => prev + 1);
  };

  const canAccess = (screen: ScreenType): boolean => {
    if (isAdmin) return true;
    const officerScreens: ScreenType[] = ['overview', 'new-scan', 'screening-report'];
    const inchargeScreens: ScreenType[] = ['overview', 'officer-status', 'screening-report', 'audit-trail'];
    if (user?.role === 'OFFICER') return officerScreens.includes(screen);
    if (user?.role === 'POST_INCHARGE') return inchargeScreens.includes(screen);
    return false;
  };

  const safeNavigate = (screen: ScreenType) => {
    if (canAccess(screen)) {
      setCurrentScreen(screen);
      setIsMobileMenuOpen(false);
      trackPageView(screen);
    }
  };

  return (
    <div className="min-h-screen bg-[#0c1017] text-[#f1f5f9] flex flex-col antialiased selection:bg-[#2563eb]/40">
      <Header
        currentScreen={currentScreen}
        onNavigate={safeNavigate}
        scansCount={scansCount}
        isMobileMenuOpen={isMobileMenuOpen}
        onToggleMobileMenu={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
      />

      {hasRole('ADMIN') && <RemoteLocationSyncBar onSyncCompleted={loadNeonRecords} />}

      <div className="flex-1 flex overflow-hidden relative">
        <Sidebar
          currentScreen={currentScreen}
          onNavigate={safeNavigate}
          isMobileOpen={isMobileMenuOpen}
          onCloseMobile={() => setIsMobileMenuOpen(false)}
        />

        <main className="flex-1 overflow-y-auto bg-[#faf8fe] text-[#1a1b1f] pb-16 lg:pb-0">
          {currentScreen === 'overview' && (
            <OverviewView
              records={records}
              onNavigate={safeNavigate}
              onSelectRecord={setSelectedRecord}
            />
          )}

          {currentScreen === 'new-scan' && canAccess('new-scan') && (
            <NewScanView
              onNavigate={safeNavigate}
              onAddRecord={handleAddRecord}
              onSelectRecord={setSelectedRecord}
            />
          )}

          {currentScreen === 'screening-report' && selectedRecord && (
            <ScreeningReportView
              currentRecord={selectedRecord}
              records={records}
              onSelectRecord={setSelectedRecord}
              onNavigate={safeNavigate}
            />
          )}

          {currentScreen === 'audit-trail' && canAccess('audit-trail') && (
            <AuditTrailView
              records={records}
              onSelectRecord={setSelectedRecord}
              onNavigate={safeNavigate}
            />
          )}

          {currentScreen === 'system-health-and-docs' && canAccess('system-health-and-docs') && (
            <SystemHealthDocsView />
          )}

          {currentScreen === 'admin-portal' && canAccess('admin-portal') && (
            <AdminPortalView onNavigate={safeNavigate} records={records} />
          )}

          {currentScreen === 'officer-status' && canAccess('officer-status') && (
            <OfficerStatusView records={records} onNavigate={safeNavigate} />
          )}

          {currentScreen === 'security' && canAccess('security') && (
            <SecurityView records={records} />
          )}

          {currentScreen === 'system-logs' && canAccess('system-logs') && (
            <SystemLogsView />
          )}
        </main>
      </div>

      <MobileBottomNav
        currentScreen={currentScreen}
        onNavigate={safeNavigate}
        onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
      />
    </div>
  );
}

type PageRoute = 'app' | 'privacy' | 'terms';

export default function App() {
  const [page, setPage] = useState<PageRoute>('app');

  return (
    <I18nProvider>
      <AuthProvider>
        {page === 'privacy' && <PrivacyPolicyView onBack={() => setPage('app')} />}
        {page === 'terms' && <TermsView onBack={() => setPage('app')} />}
        {page === 'app' && <AuthenticatedApp onNavigatePage={setPage} />}
        <CookieConsent onPrivacyClick={() => setPage('privacy')} />
      </AuthProvider>
    </I18nProvider>
  );
}
