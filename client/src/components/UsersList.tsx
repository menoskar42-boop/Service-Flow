import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useUsers } from "@/hooks/use-users";
import { useAuth } from "@/hooks/use-auth";
import { ROLES, type User } from "@shared/schema";
import { Trash2, Loader2, Users, Ban, CheckCircle, Pencil } from "lucide-react";

export function UsersList() {
  const [open, setOpen] = useState(false);
  const { users, isLoading, deleteUser, isDeleting, suspendUser, isSuspending, setWorkerCode, isSettingWorkerCode } = useUsers();
  const { user: currentUser } = useAuth();
  // الأدمن الأعلى يتحكّم في الكل؛ الأدمن العادى في باقى المستخدمين فقط (مش الأدمنز)
  const canManage = (u: { role: string }) =>
    currentUser?.role === ROLES.SUPER_ADMIN || (u.role !== ROLES.ADMIN && u.role !== ROLES.SUPER_ADMIN);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);

  const getRoleBadge = (role: string) => {
    switch (role) {
      case ROLES.SUPER_ADMIN:
        return <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">مدير أعلى</Badge>;
      case ROLES.ADMIN:
        return <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">مدير</Badge>;
      case ROLES.TECH:
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">فني</Badge>;
      case ROLES.SALES:
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">مبيعات</Badge>;
      case ROLES.EXTERNAL:
        return <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">شئون خارجية</Badge>;
      case ROLES.DATA_MANAGER:
        return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">مسئول البيانات</Badge>;
      default:
        return <Badge variant="outline">{role}</Badge>;
    }
  };

  const getStatusBadge = (suspended: boolean) => {
    if (suspended) {
      return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">موقوف</Badge>;
    }
    return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">نشط</Badge>;
  };

  const handleDelete = () => {
    if (userToDelete) {
      deleteUser(userToDelete.id);
      setUserToDelete(null);
    }
  };

  const handleToggleSuspend = (user: User) => {
    suspendUser({ userId: user.id, suspended: !user.suspended });
  };

  const handleEditWorkerCode = (user: User) => {
    const val = window.prompt(`رقم العامل للفني "${user.username}":`, user.workerCode || "");
    if (val !== null) setWorkerCode({ userId: user.id, workerCode: val.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="border-blue-300 text-blue-600 hover:bg-blue-50">
          <Users className="w-4 h-4 mr-2" />
          إدارة المستخدمين
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-display text-right flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            إدارة المستخدمين
            {users && <span className="text-sm text-muted-foreground font-normal">({users.length})</span>}
          </DialogTitle>
        </DialogHeader>
        
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : !users || users.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            لا يوجد مستخدمين
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="text-right" dir="rtl">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="text-right font-bold">#</TableHead>
                  <TableHead className="text-right font-bold">اسم المستخدم</TableHead>
                  <TableHead className="text-right font-bold">الدور</TableHead>
                  <TableHead className="text-right font-bold">رقم العامل</TableHead>
                  <TableHead className="text-right font-bold">الحالة</TableHead>
                  <TableHead className="text-right font-bold">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id} className={`hover:bg-muted/30 transition-colors ${user.suspended ? 'opacity-60' : ''}`}>
                    <TableCell className="font-medium">{user.id}</TableCell>
                    <TableCell className="font-medium">{user.username}</TableCell>
                    <TableCell>{getRoleBadge(user.role)}</TableCell>
                    <TableCell>
                      {user.role === ROLES.TECH ? (
                        <button
                          onClick={() => handleEditWorkerCode(user)}
                          disabled={isSettingWorkerCode}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                          title="تعديل رقم العامل">
                          {user.workerCode || "—"} <Pencil className="w-3 h-3" />
                        </button>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(user.suspended)}</TableCell>
                    <TableCell>
                      {user.id === currentUser?.id ? (
                        <span className="text-xs text-muted-foreground">(حسابك)</span>
                      ) : !canManage(user) ? (
                        <span className="text-xs text-muted-foreground">(مدير — للأدمن الأعلى فقط)</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className={user.suspended 
                              ? "text-green-600 border-green-300 hover:bg-green-50" 
                              : "text-orange-600 border-orange-300 hover:bg-orange-50"
                            }
                            onClick={() => handleToggleSuspend(user)}
                            disabled={isSuspending}
                            data-testid={`button-suspend-user-${user.id}`}
                          >
                            {isSuspending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : user.suspended ? (
                              <CheckCircle className="w-4 h-4" />
                            ) : (
                              <Ban className="w-4 h-4" />
                            )}
                          </Button>
                          
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive border-destructive/30 hover:bg-destructive/10"
                                onClick={() => setUserToDelete(user)}
                                disabled={isDeleting}
                                data-testid={`button-delete-user-${user.id}`}
                              >
                                {isDeleting ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Trash2 className="w-4 h-4" />
                                )}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent dir="rtl">
                              <AlertDialogHeader>
                                <AlertDialogTitle className="text-right">تأكيد حذف المستخدم</AlertDialogTitle>
                                <AlertDialogDescription className="text-right">
                                  هل أنت متأكد من حذف المستخدم "{user.username}"؟ لا يمكن التراجع عن هذا الإجراء.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter className="flex-row-reverse gap-2">
                                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={handleDelete}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  حذف
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
