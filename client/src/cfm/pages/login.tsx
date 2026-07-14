import { useStore } from "@/cfm/lib/store";
import { translations } from "@/cfm/lib/i18n";
import { useLocation } from "wouter";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/cfm/components/ui/card";
import { Button } from "@/cfm/components/ui/button";
import { Input } from "@/cfm/components/ui/input";
import { Label } from "@/cfm/components/ui/label";
import { ShieldCheck } from "lucide-react";
import { useToast } from "@/cfm/hooks/use-toast";
import { authApi } from "@/cfm/lib/api";
import type { User } from "@/cfm/lib/types";

export default function Login() {
  const { setUser, language, sessionExpiredMessage, setSessionExpiredMessage } = useStore();
  const t = translations[language];
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSessionExpiredMessage(null);
    try {
      const apiUser = await authApi.login(username, password);
      const user: User = {
        id: apiUser.id,
        username: apiUser.username,
        name: apiUser.name,
        role: apiUser.role as User['role'],
        avatar: apiUser.avatar || undefined,
        isInitialPassword: apiUser.isInitialPassword,
      };
      setUser(user);
      setLocation("/");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || t.loginError
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center space-y-4 pb-8">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
            <ShieldCheck className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold text-primary">{t.appTitle}</CardTitle>
          <p className="text-sm text-muted-foreground">{t.login}</p>
          {sessionExpiredMessage && (
            <div className="bg-amber-50 border border-amber-300 text-amber-800 px-4 py-3 rounded-md text-sm font-medium" data-testid="session-expired-message">
              {sessionExpiredMessage}
            </div>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="username">{t.username}</Label>
              <Input 
                id="username" 
                value={username} 
                onChange={(e) => setUsername(e.target.value)} 
                required 
                className="text-right ltr:text-left"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t.password}</Label>
              <Input 
                id="password" 
                type="password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                required 
                className="text-right ltr:text-left"
              />
            </div>
            <Button type="submit" className="w-full h-11 text-lg" disabled={loading}>
              {loading ? "..." : t.loginButton}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
