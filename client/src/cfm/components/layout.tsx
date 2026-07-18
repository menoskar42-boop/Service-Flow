import { Link, useLocation } from "wouter";
import { useStore } from "@/cfm/lib/store";
import { authApi } from "@/cfm/lib/api";
import { translations } from "@/cfm/lib/i18n";
import { 
  LayoutDashboard, 
  Ticket, 
  Database, 
  Settings, 
  LogOut, 
  Globe,
  Menu,
  X,
  UserCircle,
  Package,
  FileText,
  Users,
  Key,
  Cable
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/cfm/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/cfm/components/ui/sheet";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/cfm/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/cfm/components/ui/dialog";
import { Input } from "@/cfm/components/ui/input";
import { Label } from "@/cfm/components/ui/label";
import { useToast } from "@/cfm/hooks/use-toast";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { language, setLanguage, user, logout, changePassword } = useStore();
  const t = translations[language];
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  
  // Change Password State
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const { toast } = useToast();

  const handleLogout = async () => {
    // لو المستخدم داخل عن طريق Service-Flow (SSO) السيرفر بيرجّع redirect لدخول الطلبات →
    // نروح هناك بتنقّل صفحة كاملة (خروج كامل). لو كوابل مباشر → دخول الكوابل زى ما هو.
    let redirect: string | undefined;
    try { redirect = (await authApi.logout())?.redirect; } catch { /* تجاهل */ }
    logout(); // امسح الحالة المحلية
    if (redirect) { window.location.href = redirect; return; }
    setLocation("/login");
    toast({ title: t.logoutSuccess });
  };

  const handleChangePassword = () => {
    if (newPassword !== confirmPassword) {
      toast({ variant: "destructive", title: "Error", description: t.passwordsDoNotMatch });
      return;
    }
    if (newPassword.length < 6) {
      toast({ variant: "destructive", title: "Error", description: "Password must be at least 6 characters" });
      return;
    }
    changePassword(newPassword);
    setIsChangePasswordOpen(false);
    setNewPassword("");
    setConfirmPassword("");
    toast({ title: t.passwordChanged });
  };

  const NavItem = ({ href, icon: Icon, label }: { href: string; icon: any; label: string }) => {
    const isActive = location === href;
    return (
      <Link href={href}>
        <div className={`
          flex items-center gap-3 px-4 py-3 rounded-md transition-all cursor-pointer font-medium
          ${isActive 
            ? 'bg-primary/10 text-primary border-r-2 border-primary' 
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'}
        `}>
          <Icon size={20} />
          <span>{label}</span>
        </div>
      </Link>
    );
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="p-6 border-b border-sidebar-border flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-white p-1 flex items-center justify-center shrink-0">
          <Cable className="w-6 h-6 text-amber-600" />
        </div>
        <div>
          <h1 className="font-bold text-lg leading-tight tracking-tight">Cable Guardian</h1>
          <p className="text-xs text-muted-foreground font-mono">MVP v1.0</p>
        </div>
      </div>

      <div className="flex-1 py-6 px-3 space-y-1">
        <NavItem href="/" icon={LayoutDashboard} label={t.dashboard} />
        <NavItem href="/tickets" icon={Ticket} label={t.tickets} />
        
        {(user?.role === 'admin' || user?.role === 'cable_engineer' || user?.role === 'supervisor') && (
          <NavItem href="/inventory" icon={Package} label={t.inventory} />
        )}

        <NavItem href="/reports" icon={FileText} label={t.reports} />

        {user?.role === 'admin' && (
          <>
            <NavItem href="/master-data" icon={Database} label={t.masterData} />
            <NavItem href="/users" icon={Users} label={t.users} />
          </>
        )}

        {/* رجوع لموقع Service-Flow (رابط مطلق يخرج من قسم /cfm) */}
        <a href="/" className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent transition-colors mt-4">
          <LogOut className="w-5 h-5 rotate-180" />
          <span>الرجوع لـ Service-Flow</span>
        </a>
      </div>

      <div className="p-4 border-t border-sidebar-border space-y-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div className="flex items-center gap-3 px-2 py-2 rounded-md bg-sidebar-accent/50 cursor-pointer hover:bg-sidebar-accent transition-colors">
              <UserCircle className="text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user?.name || 'Guest'}</p>
                <p className="text-xs text-muted-foreground capitalize truncate">{user?.role?.replace('_', ' ') || '-'}</p>
              </div>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{t.settings}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setIsChangePasswordOpen(true)}>
              <Key className="mr-2 h-4 w-4" />
              <span>{t.changePassword}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600">
              <LogOut className="mr-2 h-4 w-4" />
              <span>{t.logout}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );

  // If on login page, render simpler layout (just children) or if no user and not on login page (will be handled by router redirect usually)
  // Ideally App.tsx handles redirects. But here we can hide sidebar if no user.
  if (!user && location !== "/login") {
     // Wait for redirect in App.tsx, but render nothing or basic wrapper
     return <div className="min-h-screen bg-background">{children}</div>;
  }
  
  if (location === "/login") {
    return <div className="min-h-screen bg-gray-50">{children}</div>;
  }

  return (
    <div className="flex h-screen bg-background font-sans" dir="ltr">
      {/* Desktop Sidebar */}
      <aside className="hidden md:block w-64 shrink-0 shadow-xl z-20">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar */}
      <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
        <SheetContent side="left" className="p-0 w-64 border-r-0">
          <SidebarContent />
        </SheetContent>
      </Sheet>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-16 border-b bg-card flex items-center justify-between px-6 shrink-0 z-10">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon" 
              className="md:hidden"
              onClick={() => setIsMobileOpen(true)}
            >
              <Menu />
            </Button>
            <h2 className="text-xl font-semibold hidden md:block">
              {location === '/' ? t.dashboard : 
               location.startsWith('/tickets') ? t.tickets : 
               location === '/master-data' ? t.masterData : 
               location === '/users' ? t.users :
               location === '/reports' ? t.reportsTitle : ''}
            </h2>
          </div>

          <div className="flex items-center gap-3">
             <Button 
              variant="outline" 
              size="sm" 
              className="gap-2 font-mono text-xs"
              onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
            >
              <Globe size={14} />
              {language === 'en' ? 'عربي' : 'English'}
            </Button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 md:p-8 bg-secondary/30">
          <div className="max-w-6xl mx-auto w-full animate-in fade-in duration-500">
            {children}
          </div>
        </div>
      </main>

      {/* Change Password Dialog */}
      <Dialog open={isChangePasswordOpen} onOpenChange={setIsChangePasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.changePassword}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t.newPassword}</Label>
              <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t.confirmPassword}</Label>
              <Input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleChangePassword}>{t.submit}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

