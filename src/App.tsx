import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import HomePage from './pages/Home';
import PortfolioPage from './pages/Portfolio';
import AccountPage from './pages/Account';
import RenewalsPage from './pages/Renewals';
import TasksPage from './pages/Tasks';
import AlertsPage from './pages/Alerts';
import SuccessPlansPage from './pages/SuccessPlans';
import ContactsPage from './pages/Contacts';
import ContactPage from './pages/Contact';
import NpsPage from './pages/Nps';
import ReportsPage from './pages/Reports';
import SettingsPage from './pages/Settings';
import AdminPage from './pages/Admin';
import AskPage from './pages/Ask';
import LibraryPage from './pages/Library';
import ImportPage from './pages/Import';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="/ask" element={<AskPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/portfolio" element={<PortfolioPage />} />
        <Route path="/company/:id" element={<AccountPage />} />
        <Route path="/renewals" element={<RenewalsPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/success-plans" element={<SuccessPlansPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/contacts/:id" element={<ContactPage />} />
        <Route path="/nps" element={<NpsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
