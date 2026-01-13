import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { 
  LogOut, 
  LayoutDashboard, 
  UserCircle,
  Menu,
  X
} from "lucide-react";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);

  if (!user) return <>{children}</>;

  const NavContent = () => (
    <div className="flex flex-col h-full">
      <div className="py-6">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-blue-700 bg-clip-text text-transparent font-display">
          OrderFlow
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Real-time Management</p>
      </div>

      <nav className="flex-1 space-y-1">
        <Link href="/" className={`
          flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200
          ${location === "/" 
            ? "bg-primary/10 text-primary font-semibold shadow-sm" 
            : "text-muted-foreground hover:bg-muted hover:text-foreground"}
        `}>
          <LayoutDashboard className="w-5 h-5" />
          Dashboard
        </Link>
      </nav>

      <div className="border-t pt-4 mt-auto space-y-4">
        <div className="flex items-center gap-3 px-4">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            <UserCircle className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{user.username}</p>
            <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">{user.role}</p>
          </div>
        </div>
        <Button 
          variant="ghost" 
          className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={() => logout()}
        >
          <LogOut className="w-5 h-5 mr-2" />
          Sign Out
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50/50 dark:bg-zinc-950">
      {/* Mobile Header */}
      <div className="lg:hidden flex items-center justify-between p-4 bg-background border-b sticky top-0 z-50">
        <h1 className="text-xl font-bold font-display text-primary">OrderFlow</h1>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="w-6 h-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[80%] sm:w-[300px] p-4">
            <NavContent />
          </SheetContent>
        </Sheet>
      </div>

      <div className="flex">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:block w-64 h-screen sticky top-0 border-r bg-background p-6 shadow-[4px_0_24px_-12px_rgba(0,0,0,0.1)]">
          <NavContent />
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-4 lg:p-8 overflow-x-hidden w-full max-w-[100vw]">
          <div className="max-w-7xl mx-auto space-y-8 animate-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
