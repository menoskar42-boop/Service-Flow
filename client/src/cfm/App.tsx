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
import { useEffect, useCallback, useState } from "react";
import { setSessionExpiredHandler } from "@/cfm/lib/api";

function Router() {
  const { user, setUser, setSessionExpiredMessage } = useStore();
  const [location, setLocation] = useLocation();
  // الدخول الموحّد (SSO): عند فتح الكوابل نتحقّق **دايماً** من جلسة السيرفر ونزامن
  // الـ store معها — عشان مايظهرش مستخدم قديم محفوظ فى localStorage (زى ما كان الفنى
  // بيتفتحله أدمن بسبب جلسة سوبر أدمن سابقة على نفس المتصفح).
  const [checkingSession, setCheckingSession] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/cfm/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        if (cancelled) return;
        const cur = useStore.getState().user;
        if (u && u.id) {
          if (!cur || cur.id !== u.id) setUser(u); // زامن مع جلسة السيرفر
        } else if (cur) {
          setUser(null); // مفيش جلسة سيرفر → امسح أى مستخدم قديم محفوظ
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setCheckingSession(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // (اتشال مؤقّت الخمول اللى كان بيسجّل خروج بعد ٣٠ دقيقة بدون حركة — كان بيتعارض
  //  مع البوابة الموحّدة؛ الجلسة دلوقتى محكومة بجلسة السيرفر المشتركة)

  useEffect(() => {
    if (!user && !checkingSession && location !== "/login") {
      setLocation("/login");
    }
  }, [user, checkingSession, location, setLocation]);

  if (!user) {
    // أثناء التحقق من جلسة السيرفر (SSO) — ماتوريش صفحة الدخول عشان مايحصلش وميض
    if (checkingSession) {
      return <Layout><div className="p-10 text-center text-muted-foreground">جارٍ التحقق من الدخول…</div></Layout>;
    }
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
