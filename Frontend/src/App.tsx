import React, { useState } from "react";
import { Routes, Route } from "react-router-dom";
import AppShell from "./layouts/AppShell";
import {
  LoginPage,
  AuthProvider,
  AuthGate,
  AppProviders,
  DebugBanner,
  // @ts-ignore: useAuth ist in der aktualisierten Library vorhanden
  useAuth,
} from "@schlayer-consulting/sc-base-frontend";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;
const API_BASE = `${SERVER_URL}/api/v1`;

export default function App() {
  const isDebugMode =
    String(import.meta.env.VITE_DEBUG).toLowerCase() === "true";
  const [globalError, setGlobalError] = useState<string>("");

  const LoginWithAuth: React.FC = () => {
    const { login } = useAuth();
    return <LoginPage apiBase={API_BASE} debug={isDebugMode} onLogin={login} />;
  };
  return (
    <AppProviders>
      <DebugBanner enabled={isDebugMode} />
      <AuthProvider apiBase={API_BASE}>
        <Routes>
          <Route
            path="/documentsupload/:id"
            element={
              <AuthGate unauthenticated={<LoginWithAuth />}>
                <AppShell
                  globalError={globalError}
                  setGlobalError={setGlobalError}
                />
              </AuthGate>
            }
          />
          <Route
            path="/*"
            element={
              <AuthGate unauthenticated={<LoginWithAuth />}>
                <AppShell
                  globalError={globalError}
                  setGlobalError={setGlobalError}
                />
              </AuthGate>
            }
          />
        </Routes>
      </AuthProvider>
    </AppProviders>
  );
}
