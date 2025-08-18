import React, { Suspense, lazy, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useMatch } from "react-router-dom";
import { FileText, User, Users } from "lucide-react";
import VoiceScanPage from "../pages/VoiceScanPage";
const UsersPage = lazy(() =>
  import("@schlayer-consulting/sc-base-frontend").then((m) => ({
    default: m.UsersPage,
  }))
);
const OrganisationsPage = lazy(() =>
  import("@schlayer-consulting/sc-base-frontend").then((m) => ({
    default: m.OrganisationsPage,
  }))
);
// @ts-ignore: useAuth ist in der aktualisierten Library vorhanden
import {
  AppShell as BaseAppShell,
  UserMenu,
  useAuth,
} from "@schlayer-consulting/sc-base-frontend";
const DocumentUploadPage = lazy(() => import("../pages/DocumentUploadPage"));

interface AppShellProps {
  globalError: string;
  setGlobalError: React.Dispatch<React.SetStateAction<string>>;
}

const features = [
  { key: "documentsupload", label: "feature_documents_upload", icon: FileText },
  { key: "voicescan", label: "feature_voicescan", icon: FileText },
  { key: "users", label: "feature_users", icon: User, adminOnly: true },
  {
    key: "organisations",
    label: "feature_organisations",
    icon: Users,
    superAdminOnly: true,
  },
];

const AppShell: React.FC<AppShellProps> = ({ globalError, setGlobalError }) => {
  const { t } = useTranslation("AppShell");
  const navigate = useNavigate();
  const {
    token,
    user: userInfo,
    loading: authLoading,
    refreshUser,
    setUser,
  } = useAuth();
  const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;
  const API_BASE = `${SERVER_URL}/api/v1`;

  // Sidebar Collapsed State mit Persistenz
  const STORAGE_KEY = "notenscan.sidebarCollapsed";
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) return JSON.parse(saved);
    } catch {}
    // Default: auf kleinen Screens collapsed
    if (typeof window !== "undefined") {
      return (
        window.matchMedia && window.matchMedia("(max-width: 1024px)").matches
      );
    }
    return false;
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sidebarCollapsed));
    } catch {}
  }, [sidebarCollapsed]);

  // Prefetch-Handler
  const prefetchFeature = (key: string) => {
    if (key === "documentsupload") {
      import("../pages/DocumentUploadPage");
    } else if (key === "users") {
      import("@schlayer-consulting/sc-base-frontend").then((m) => m.UsersPage);
    } else if (key === "organisations") {
      import("@schlayer-consulting/sc-base-frontend").then(
        (m) => m.OrganisationsPage
      );
    }
  };

  const matchVoicescan = useMatch("/voicescan");
  const matchUserDetail = useMatch("/users/:id");
  const matchUser = useMatch({ path: "/users", end: true });
  const matchOrganisationDetail = useMatch("/organisations/:id");
  const matchOrganisation = useMatch({ path: "/organisations", end: true });
  const matchDocuments = useMatch("/documentsupload");
  const matchDocumentsDetail = useMatch("/documentsupload/:id");

  let feature = "documentsupload";
  let userId: number | null = null;
  let organisationId: number | null = null;
  let documentId: string | undefined = undefined;

  if (matchDocumentsDetail) {
    feature = "documentsupload";
    documentId = matchDocumentsDetail.params.id;
  } else if (matchDocuments) {
    feature = "documentsupload";
  } else if (matchVoicescan) {
    feature = "voicescan";
  } else if (matchUserDetail) {
    feature = "users";
    userId = Number(matchUserDetail.params.id);
  } else if (matchUser) {
    feature = "users";
  } else if (matchOrganisationDetail) {
    feature = "organisations";
    organisationId = Number(matchOrganisationDetail.params.id);
  } else if (matchOrganisation) {
    feature = "organisations";
  }

  const handleMenuClick = (key: string) => {
    if (key === "documentsupload") {
      navigate("/documentsupload");
    } else if (key === "voicescan") {
      navigate("/voicescan");
    } else if (key === "users") {
      navigate("/users");
    } else if (key === "organisations") {
      navigate("/organisations");
    }
  };

  let content: React.ReactNode = null;
  if (authLoading) {
    // Loader wird über BaseAppShell.loadingFallback gesteuert
    content = null;
  } else {
    if (feature === "documentsupload") {
      content = (
        <DocumentUploadPage initialId={documentId} token={token || ""} />
      );
    } else if (feature === "voicescan") {
      content = <VoiceScanPage token={token || ""} onRefresh={() => {}} />;
    } else if (feature === "users") {
      content = (
        <UsersPage
          key={`users-${userId ?? "list"}`}
          token={token || ""}
          apiBase={API_BASE}
          initialId={userId ?? undefined}
          userInfo={userInfo}
        />
      );
    } else if (feature === "organisations") {
      content = (
        <OrganisationsPage
          key={`org-${organisationId ?? "list"}`}
          token={token || ""}
          apiBase={API_BASE}
          initialId={organisationId ?? undefined}
        />
      );
    } else {
      content = (
        <div className="p-8 text-blue-700 font-semibold">
          {t("dashboard_select_feature")}
        </div>
      );
    }
  }

  const allowedFeatures = features;
  const featureMeta = allowedFeatures.find((f) => f.key === feature);

  return (
    <BaseAppShell
      appName={t("app_name")}
      // Placeholder-Logo (später austauschbar)
      // @ts-ignore: neue Prop in aktualisierter Library
      appLogo={<img src="/favicon.svg" alt="App Logo" className="w-8 h-8" />}
      // @ts-ignore: headerCenter ist in der aktualisierten Library vorhanden; lokale Typen werden gleich nachgezogen
      headerCenter={
        <h1 className="text-xl font-semibold flex items-center gap-3 m-0 truncate">
          {featureMeta && React.createElement(featureMeta.icon, { size: 24 })}
          <span className="truncate">
            {featureMeta?.label ? t(featureMeta.label) : ""}
          </span>
        </h1>
      }
      rightHeader={
        <>
          {userInfo?.username && (
            <span
              className="text-base font-medium text-blue-700 truncate max-w-[120px]"
              title={userInfo.username}
            >
              {userInfo.username}
            </span>
          )}
          <UserMenu
            onLogout={() => {
              localStorage.removeItem("token");
              window.location.reload();
            }}
            userInfo={userInfo}
            token={token || undefined}
            setUserInfo={setUser}
            onUserSettingsSaved={refreshUser}
            apiBase={API_BASE}
          />
        </>
      }
      // @ts-ignore: neue Props sind in der aktualisierten Library vorhanden
      sidebarCollapsed={sidebarCollapsed}
      // @ts-ignore: neue Props sind in der aktualisierten Library vorhanden
      onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
      error={globalError}
      onCloseError={() => setGlobalError("")}
      errorTitleLabel={t("error")}
      closeLabel={t("close")}
      loading={authLoading}
      loadingFallback={
        <div className="w-full h-full flex items-center justify-center text-gray-500">
          <div className="animate-pulse">{t("loading")}</div>
        </div>
      }
      navItems={allowedFeatures.map((f) => ({
        key: f.key,
        label: t(f.label),
        icon: React.createElement(f.icon, { size: 20 }),
      }))}
      activeKey={feature}
      onSelect={handleMenuClick}
      onPrefetch={prefetchFeature}
    >
      <Suspense
        fallback={
          <div className="w-full h-full flex items-center justify-center text-gray-500">
            <div className="animate-pulse">{t("loading")}</div>
          </div>
        }
      >
        {content}
      </Suspense>
    </BaseAppShell>
  );
};

export default AppShell;
