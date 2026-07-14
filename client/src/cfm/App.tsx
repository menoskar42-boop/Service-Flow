import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/cfm/components/ui/toaster";
import { TooltipProvider } from "@/cfm/components/ui/tooltip";
import Layout from "@/cfm/components/layout";
import Dashboard from "@/cfm/pages/dashboard";
import TicketList from "@/cfm/pages/tickets/list";
import CreateTicket from "@/cfm/pages/tickets/create";
import TicketDetail from "@/cfm/pages/tickets/detail";
import MasterData from "@/cfm/pages/master-data";
import Inventory from "@/cfm/pages/inventory";
import Reports from "@/cfm/pages/reports";
import Login from "@/cfm/pages/login";
import Users from "@/cfm/pages/users";
import NotFound from "@/cfm/pages/not-found";
import { useStore } from "@/cfm/lib/store";
import { useEffect, useCallback, useRef } from "react";
import { setSessionExpiredHandler } from "@/cfm/lib/api";

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

function Router() {
  const { user, setUser, setSessionExpiredMessage } = useStore();
  const [location, setLocation] = useLocation();
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSessionExpired = useCallback(() => {
    const currentUser = useStore.getState().user;
    if (!currentUser) return;
    setUser(null);
    setSessionExpiredMessage("انتهت الجلسة، برجاء تسجيل الدخول مرة أخرى");
    setLocation("/login");
  }, [setUser, setSessionExpiredMessage, setLocation]);

  useEffect(() => {
    setSessionExpiredHandler(handleSessionExpired);
  }, [handleSessionExpired]);

  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimer.current) {
      clearTimeout(inactivityTimer.current);
    }
    if (useStore.getState().user) {
      inactivityTimer.current = setTimeout(() => {
        handleSessionExpired();
      }, INACTIVITY_TIMEOUT_MS);
    }
  }, [handleSessionExpired]);

  useEffect(() => {
    if (!user) {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      return;
    }
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'];
    events.forEach(e => window.addEventListener(e, resetInactivityTimer));
    resetInactivityTimer();
    return () => {
      events.forEach(e => window.removeEventListener(e, resetInactivityTimer));
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    };
  }, [user, resetInactivityTimer]);

  useEffect(() => {
    if (!user && location !== "/login") {
      setLocation("/login");
    }
  }, [user, location, setLocation]);

  if (!user) {
    return (
      <Layout>
        <Switch>
          <Route path="/login" component={Login} />
          <Route component={() => null} />
        </Switch>
      </Layout>
    );
  }

  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/tickets" component={TicketList} />
        <Route path="/tickets/create" component={CreateTicket} />
        <Route path="/tickets/:id" component={TicketDetail} />
        <Route path="/inventory" component={Inventory} />
        <Route path="/reports" component={Reports} />
        <Route path="/master-data" component={MasterData} />
        <Route path="/users" component={Users} />
        <Route path="/login" component={() => {
           setLocation("/");
           return null;
        }} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
