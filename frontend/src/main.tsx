import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Layout } from "./components/Layout";
import "./index.css";
import { I18nProvider } from "./lib/i18n";
import { LiveProvider } from "./lib/live";
import { ThemeProvider } from "./lib/theme";
import { ContractSettingsPage } from "./pages/ContractSettings";
import { DevicesPage } from "./pages/Devices";
import { HistoryPage } from "./pages/History";
import { LivePage } from "./pages/Live";
import { P1SettingsPage } from "./pages/P1Settings";
import { PlugSettingsPage } from "./pages/PlugSettings";
import { SettingsPage } from "./pages/Settings";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 5_000 } },
});

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <LivePage /> },
      { path: "/history", element: <HistoryPage /> },
      { path: "/devices", element: <DevicesPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "/settings/p1", element: <P1SettingsPage /> },
      { path: "/settings/contract", element: <ContractSettingsPage /> },
      { path: "/settings/plugs", element: <PlugSettingsPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <LiveProvider>
            <RouterProvider router={router} />
          </LiveProvider>
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);
