import { useStore } from "@/cfm/lib/store";
import { translations } from "@/cfm/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/cfm/components/ui/card";
import { Button } from "@/cfm/components/ui/button";
import { Input } from "@/cfm/components/ui/input";
import { Label } from "@/cfm/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/cfm/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/cfm/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/cfm/components/ui/select";
import { Users as UsersIcon, Plus, Trash2, Key, Edit, AlertCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { useToast } from "@/cfm/hooks/use-toast";
import { Role } from "@/cfm/lib/types";
import { usersApi } from "@/cfm/lib/api";
import type { User as UserType } from "@/cfm/lib/api";

export default function Users() {
  const { user, language } = useStore();
  const t = translations[language];
  const { toast } = useToast();
  
  // API-fetched users for database persistence
  const [users, setUsers] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch users from API
  const fetchUsers = async () => {
    try {
      const usersData = await usersApi.getAll();
      setUsers(usersData);
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    
    // Refetch when window gains focus
    const handleFocus = () => fetchUsers();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);
  
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);
  
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    username: '',
    name: '',
    role: 'ext_tech' as Role,
    password: ''
  });
  
  const [newPassword, setNewPassword] = useState('');

  // Only admin can access
  if (user?.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center">
        <AlertCircle size={48} className="text-red-500 mb-4" />
        <h2 className="text-2xl font-bold text-muted-foreground">Access Denied</h2>
        <p>Only Administrators can view this page.</p>
      </div>
    );
  }

  const handleAdd = async () => {
    if (!formData.username || !formData.name || !formData.password) {
      toast({ variant: "destructive", title: "Error", description: "All fields are required" });
      return;
    }
    
    // Check duplicates
    if (users.some(u => u.username === formData.username)) {
      toast({ variant: "destructive", title: "Error", description: "Username already exists" });
      return;
    }

    try {
      await usersApi.create(formData);
      await fetchUsers(); // Refresh list
      setIsAddOpen(false);
      setFormData({ username: '', name: '', role: 'ext_tech', password: '' });
      toast({ title: t.userAdded });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to add user" });
    }
  };

  const handleEdit = async () => {
    if (!selectedUser || !formData.name) return;
    
    try {
      await usersApi.update(selectedUser, { name: formData.name, role: formData.role });
      await fetchUsers(); // Refresh list
      setIsEditOpen(false);
      setSelectedUser(null);
      toast({ title: t.userUpdated });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to update user" });
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this user?")) {
      try {
        await usersApi.delete(id);
        await fetchUsers(); // Refresh list
        toast({ title: t.userDeleted });
      } catch (error: any) {
        toast({ variant: "destructive", title: "Error", description: error.message || "Failed to delete user" });
      }
    }
  };

  const handleResetPassword = async () => {
    if (!selectedUser || !newPassword) return;
    try {
      await usersApi.resetPassword(selectedUser, newPassword);
      setIsResetOpen(false);
      setNewPassword('');
      toast({ title: "Password Reset Successfully" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: error.message || "Failed to reset password" });
    }
  };

  const openEdit = (u: any) => {
    setSelectedUser(u.id);
    setFormData({ ...formData, name: u.name, role: u.role, username: u.username });
    setIsEditOpen(true);
  };

  const openReset = (id: string) => {
    setSelectedUser(id);
    setNewPassword('');
    setIsResetOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <UsersIcon className="text-primary" /> {t.users}
          </h1>
          <p className="text-sm text-muted-foreground">Manage system users and roles</p>
        </div>
        
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus size={16} /> {t.addUser}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t.addUser}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>{t.fullName}</Label>
                <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>{t.username}</Label>
                <Input value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>{t.initialPassword}</Label>
                <Input type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>{t.role}</Label>
                <Select value={formData.role} onValueChange={(val: Role) => setFormData({...formData, role: val})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">{t.admin}</SelectItem>
                    <SelectItem value="supervisor">{t.supervisor}</SelectItem>
                    <SelectItem value="cable_engineer">{t.cable_engineer}</SelectItem>
                    <SelectItem value="external_affairs">{t.external_affairs}</SelectItem>
                    <SelectItem value="ext_tech">{t.ext_tech}</SelectItem>
                    <SelectItem value="splice_tech">{t.splice_tech}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleAdd}>{t.submit}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.fullName}</TableHead>
                <TableHead>{t.username}</TableHead>
                <TableHead>{t.role}</TableHead>
                <TableHead className="text-right">{t.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="font-mono text-sm">{u.username}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {t[u.role as keyof typeof t] || u.role}
                    </span>
                  </TableCell>
                  <TableCell className="text-right space-x-2 rtl:space-x-reverse">
                    <Button variant="ghost" size="sm" onClick={() => openReset(u.id)}>
                      <Key className="h-4 w-4 text-orange-500" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>
                      <Edit className="h-4 w-4 text-blue-500" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(u.id)} disabled={u.username === 'admin'}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.editUser}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t.fullName}</Label>
              <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>{t.role}</Label>
              <Select value={formData.role} onValueChange={(val: Role) => setFormData({...formData, role: val})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t.admin}</SelectItem>
                  <SelectItem value="supervisor">{t.supervisor}</SelectItem>
                  <SelectItem value="cable_engineer">{t.cable_engineer}</SelectItem>
                  <SelectItem value="external_affairs">{t.external_affairs}</SelectItem>
                  <SelectItem value="ext_tech">{t.ext_tech}</SelectItem>
                  <SelectItem value="splice_tech">{t.splice_tech}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleEdit}>{t.submit}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={isResetOpen} onOpenChange={setIsResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.resetPassword}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t.newPassword}</Label>
              <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleResetPassword}>{t.submit}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
