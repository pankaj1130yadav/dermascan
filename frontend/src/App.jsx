import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { LanguageProvider } from './i18n.jsx';
import Navbar from './components/Navbar.jsx';
import Footer from './components/Footer.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import OfflineBanner from './components/OfflineBanner.jsx';
import FaqChat from './components/FaqChat.jsx';
import Landing from './pages/Landing.jsx';
import Analyze from './pages/Analyze.jsx';
import History from './pages/History.jsx';
import Learn from './pages/Learn.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ModelPage from './pages/Model.jsx';
import Abcde from './pages/Abcde.jsx';
import BodyMap from './pages/BodyMap.jsx';
import Gallery from './pages/Gallery.jsx';
import Consult from './pages/Consult.jsx';
import Profiles from './pages/Profiles.jsx';
import Compare from './pages/Compare.jsx';
import Shared from './pages/Shared.jsx';
import Admin from './pages/Admin.jsx';
import Reviews from './pages/Reviews.jsx';
import { Login, Register } from './pages/Auth.jsx';

const P = ({ children }) => <ProtectedRoute>{children}</ProtectedRoute>;

export default function App() {
  return (
    <BrowserRouter>
      <LanguageProvider>
        <AuthProvider>
          <div className="app">
            <Navbar />
            <OfflineBanner />
            <main className="main">
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/learn" element={<Learn />} />
                <Route path="/model" element={<ModelPage />} />
                <Route path="/gallery" element={<Gallery />} />
                <Route path="/abcde" element={<Abcde />} />
                <Route path="/shared/:token" element={<Shared />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/analyze" element={<P><Analyze /></P>} />
                <Route path="/history" element={<P><History /></P>} />
                <Route path="/dashboard" element={<P><Dashboard /></P>} />
                <Route path="/bodymap" element={<P><BodyMap /></P>} />
                <Route path="/consult" element={<P><Consult /></P>} />
                <Route path="/profiles" element={<P><Profiles /></P>} />
                <Route path="/compare" element={<P><Compare /></P>} />
                <Route path="/admin" element={<P><Admin /></P>} />
                <Route path="/reviews" element={<P><Reviews /></P>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
            <Footer />
            <FaqChat />
          </div>
        </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  );
}
