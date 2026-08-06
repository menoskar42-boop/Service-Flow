import { useStore } from "@/cfm/lib/store";
import { translations } from "@/cfm/lib/i18n";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/cfm/components/ui/button";
import { Input } from "@/cfm/components/ui/input";
import { Textarea } from "@/cfm/components/ui/textarea";
import { 
  Form, 
  FormControl, 
  FormField, 
  FormItem, 
  FormLabel, 
  FormMessage 
} from "@/cfm/components/ui/form";
import { Label } from "@/cfm/components/ui/label";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/cfm/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/cfm/components/ui/card";
import { MapPin, Loader2, Save } from "lucide-react";
import { useState, useEffect } from "react";
import { useToast } from "@/cfm/hooks/use-toast";
import { masterDataApi, ticketsApi } from "@/cfm/lib/api";
import type { Central, Cable, FaultType } from "@/cfm/lib/api";

const formSchema = z.object({
  centralDepartment: z.string().min(1, "Required"),
  centralId: z.string().min(1, "Required"),
  cableId: z.string().min(1, "Required"),
  cabinet: z.string().optional(),
  box: z.string().min(1, "Required"),
  faultTypeId: z.string().min(1, "Required"),
  notes: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export default function CreateTicket() {
  const { language, user } = useStore();
  const t = translations[language];
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLocating, setIsLocating] = useState(false);
  // سبب منع فتح التكت (بكس عليه تكت مفتوحة بالفعل) — بيفضل ظاهر لحد ما يحاول تانى
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null);
  
  // API-fetched master data for real-time sync
  const [centrals, setCentrals] = useState<Central[]>([]);
  const [cables, setCables] = useState<Cable[]>([]);
  const [faultTypes, setFaultTypes] = useState<FaultType[]>([]);

  // Fetch master data from API
  const fetchMasterData = async () => {
    try {
      const [centralsData, cablesData, faultTypesData] = await Promise.all([
        masterDataApi.getCentrals(),
        masterDataApi.getCables(),
        masterDataApi.getFaultTypes()
      ]);
      setCentrals(centralsData);
      setCables(cablesData);
      setFaultTypes(faultTypesData);
    } catch (error) {
      console.error('Failed to fetch master data:', error);
    }
  };

  // Fetch on mount and refetch when window gains focus (to catch master data changes)
  useEffect(() => {
    fetchMasterData();
    
    const handleFocus = () => fetchMasterData();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  // Permission Check
  const isRestrictedUser = user?.role === 'splice_tech' || user?.role === 'cable_engineer';
  
  if (isRestrictedUser) {
    return (
      <div className="max-w-3xl mx-auto space-y-6 pb-12 pt-10 text-center">
        <h1 className="text-2xl font-bold text-destructive">Access Denied</h1>
        <p className="text-muted-foreground">You do not have permission to create tickets.</p>
        <Button variant="outline" onClick={() => setLocation("/tickets")}>Back to Tickets</Button>
      </div>
    );
  }

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      centralDepartment: "External Plant", // Default
      cabinet: "",
      box: "",
      notes: "",
    },
  });

  const selectedCentralId = form.watch("centralId");
  const filteredCables = cables.filter(c => c.centralId === selectedCentralId);
  const selectedCableId = form.watch("cableId");
  const selectedCable = cables.find(c => c.id === selectedCableId);

  const handleLocationCapture = () => {
    setIsLocating(true);
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          form.setValue("latitude", position.coords.latitude);
          form.setValue("longitude", position.coords.longitude);
          setIsLocating(false);
          toast({
            title: "Location Captured",
            description: `Lat: ${position.coords.latitude.toFixed(4)}, Long: ${position.coords.longitude.toFixed(4)}`,
          });
        },
        (error) => {
          setIsLocating(false);
          toast({
            variant: "destructive",
            title: "Location Error",
            description: "Could not retrieve GPS coordinates.",
          });
        }
      );
    } else {
      setIsLocating(false);
      toast({
        variant: "destructive",
        title: "Not Supported",
        description: "Geolocation is not supported by your browser.",
      });
    }
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setBlockedMsg(null);
    try {
      await ticketsApi.create({
        ...values,
        cabinet: values.cabinet || '',
      });
      toast({
        title: "Ticket Created",
        description: "Fault ticket has been successfully registered.",
      });
      setLocation("/tickets");
    } catch (error: any) {
      const msg = error?.message || "Failed to create ticket";
      // رسالة المنع (بكس عليه تكت مفتوحة) طويلة وفيها رقم التكت — بنثبّتها فوق
      // الفورم كمان مش فى إشعار بيختفى، عشان اللى بيفتح التكت يقراها بالراحة.
      setBlockedMsg(msg);
      toast({ variant: "destructive", title: "Error", description: msg });
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t.createTicket}</h1>
        <p className="text-sm text-muted-foreground">Register a new underground cable fault</p>
      </div>

      {blockedMsg && (
        <div dir="rtl" role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          data-testid="alert-duplicate-box">
          {blockedMsg}
        </div>
      )}

      <Card className="border-t-4 border-t-primary shadow-md">
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Central */}
                <FormField
                  control={form.control}
                  name="centralId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.central}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t.selectCentral} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {centrals.map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.name} ({c.code})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Cable Number (Dependent) */}
                <FormField
                  control={form.control}
                  name="cableId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.cableNumber}</FormLabel>
                      <Select 
                        onValueChange={field.onChange} 
                        defaultValue={field.value}
                        disabled={!selectedCentralId}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={selectedCentralId ? t.selectCable : "Select Central First"} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {filteredCables.map(c => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.number} ({c.type.toUpperCase()})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Cable Type (Read-only, derived) */}
                <div className="space-y-2">
                  <Label>{t.cableType}</Label>
                  <Input 
                    value={selectedCable?.type.toUpperCase() || "-"} 
                    readOnly 
                    className="bg-muted text-muted-foreground font-mono"
                  />
                </div>

                {/* Box */}
                <FormField
                  control={form.control}
                  name="box"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.box}</FormLabel>
                      <FormControl>
                        <Input placeholder="Box No" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Fault Type */}
                <FormField
                  control={form.control}
                  name="faultTypeId"
                  render={({ field }) => (
                    <FormItem className="col-span-1 md:col-span-2">
                      <FormLabel>{t.faultType}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t.selectFault} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {faultTypes.map(f => (
                            <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Notes */}
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.notes}</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Additional details about the fault..." 
                        className="min-h-[100px] resize-none" 
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Location Capture */}
              <div className="bg-secondary/20 p-4 rounded-lg border border-dashed border-secondary-foreground/20">
                 <div className="flex items-center justify-between mb-2">
                    <Label>{t.location}</Label>
                    <Button 
                      type="button" 
                      variant="outline" 
                      size="sm" 
                      onClick={handleLocationCapture}
                      disabled={isLocating}
                      className="text-xs gap-2"
                    >
                      {isLocating ? <Loader2 className="animate-spin h-3 w-3" /> : <MapPin className="h-3 w-3" />}
                      {t.captureLocation}
                    </Button>
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                    <Input 
                      placeholder="Latitude" 
                      value={form.watch("latitude") || ""} 
                      readOnly 
                      className="bg-muted font-mono text-xs" 
                    />
                    <Input 
                      placeholder="Longitude" 
                      value={form.watch("longitude") || ""} 
                      readOnly 
                      className="bg-muted font-mono text-xs" 
                    />
                 </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t">
                <Button variant="ghost" type="button" onClick={() => setLocation("/tickets")}>
                  {t.cancel}
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting} className="min-w-[140px] gap-2">
                  {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : <Save size={16} />}
                  {t.submit}
                </Button>
              </div>

            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
