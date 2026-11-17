"use client";

import Script from "next/script";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { filterBudgetRoots, getBudgetChildren, getBudgetRoots, getBudgetSpender, getBudgetTotal, getBudgetBalance, matchesBudgetRecord } from "./budget.js";
import { getApiBaseUrl } from "./api.js";
import { nextTheme, readSavedTheme, saveTheme } from "./theme.js";
import { isWeddingMainAdmin, weddingWorkspacePath } from "./workspace.js";
import { googleCalendarEventURL, googleCalendarURL } from "./calendar.js";
import { shouldShowGuestPage } from "./auth.js";

type RecordItem = {
  id: string; title: string; type: string; area?: string; owner?: string; dueAt?: string;
  status?: string; details?: string; event?: string; amount?: number; venue?: string; startsAt?: string; endsAt?: string;
  latitude?: number; longitude?: number; updatedAt?: string; assigneeEmail?: string; notificationKind?: string; createdBy?: string; createdByName?: string;
  parentId?: string;
  checkedIn?: boolean; checkedInAt?: string; checkedInBy?: string;
  guestName?: string; guestPhone?: string; guestInstructions?:string; arrivalType?: string; arrivalNumber?: string; arrivalAt?: string; pickupLocation?: string; assignedCar?: string; paymentStatus?: string; paidAmount?: number; billUrl?: string; billData?: string; billFileName?: string; vendor?: string;
};
type RecordKind = "task" | "budget" | "event" | "guests" | "stays" | "transport" | "notifications" | "pickups";
type AdminUser = { email: string; createdAt: string; createdBy: string };
type FamilyMember = { email: string; createdAt: string; createdBy: string; active: boolean; role?: string };
type WorkspaceUser = { email: string; createdAt: string; lastSeenAt: string };
type WeddingWorkspace = { slug: string; name: string; heading: string; mainAdminEmail: string; createdAt: string; createdBy: string };
type GoogleCredential = { credential: string };
type GuestLookup = { name:string; hotel?:string; room?:string; stayDetails?:string; pickupLocation?:string; arrivalAt?:string; assignedCar?:string; driver?:string; pickupStatus?:string };
declare global { interface Window { google?: { accounts: { id: { initialize: (o: {client_id:string;callback:(r:GoogleCredential)=>void})=>void; renderButton:(el:HTMLElement,o:Record<string,string>)=>void } } } } }

const API = getApiBaseUrl(process.env.NEXT_PUBLIC_API_URL);
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
const AUTH_STORAGE_KEY = "shaadi-hq-session-token";
const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
const shortDate = (value?: string) => value ? new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "No date";
const dateTimeInput = (value?: string) => { if (!value) return ""; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "ApiError"; }
}

function getSavedToken() { try { return window.localStorage.getItem(AUTH_STORAGE_KEY) || ""; } catch { return ""; } }
function saveToken(value: string) { try { window.localStorage.setItem(AUTH_STORAGE_KEY, value); } catch { /* Continue signed in for this page load if storage is disabled. */ } }
function clearSavedToken() { try { window.localStorage.removeItem(AUTH_STORAGE_KEY); } catch { /* Storage may be disabled by the browser. */ } }

async function request<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (typeof window !== "undefined") {
    const workspaceSlug = window.location.pathname.split("/").filter(Boolean)[0];
    if (workspaceSlug) headers.set("X-Wedding-Slug", workspaceSlug);
  }
  const response = await fetch(`${API}${path}`, { ...init, headers });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new ApiError(body.error || `Request failed (${response.status})`, response.status); }
  return response.status === 204 ? undefined as T : response.json();
}

export default function Home() {
  const params = useParams<{ slug?: string }>();
  const router = useRouter();
  const routeSlug = typeof params?.slug === "string" ? params.slug : "";
  const [tab, setTab] = useState("Overview");
  const [theme, setTheme] = useState<"light"|"dark">("light");
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [isMainAdmin, setIsMainAdmin] = useState(false);
  const [wedding, setWedding] = useState<WeddingWorkspace|null>(null);
  const [weddings, setWeddings] = useState<WeddingWorkspace[]>([]);
  const [tasks, setTasks] = useState<RecordItem[]>([]);
  const [expenses, setExpenses] = useState<RecordItem[]>([]);
  const [events, setEvents] = useState<RecordItem[]>([]);
  const [guestGroups, setGuestGroups] = useState<RecordItem[]>([]);
  const [stays, setStays] = useState<RecordItem[]>([]);
  const [transport, setTransport] = useState<RecordItem[]>([]);
  const [pickups, setPickups] = useState<RecordItem[]>([]);
  const [userRole, setUserRole] = useState("family");
  const [guestLookup, setGuestLookup] = useState<GuestLookup|null>(null);
  const [guestLookupError, setGuestLookupError] = useState("");
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [workspaceUsers, setWorkspaceUsers] = useState<WorkspaceUser[]>([]);
  const [notifications, setNotifications] = useState<RecordItem[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All tasks");
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [showPickupForm, setShowPickupForm] = useState(false);
  const [showWeddingForm, setShowWeddingForm] = useState(false);
  const [showWorkspaceSettings, setShowWorkspaceSettings] = useState(false);
  const [subBudgetParent, setSubBudgetParent] = useState<RecordItem|null>(null);
  const [showAdminForm, setShowAdminForm] = useState(false);
  const [accessRole, setAccessRole] = useState<"family"|"admin">("family");
  const [showNotificationForm, setShowNotificationForm] = useState(false);
  const [editingRecord, setEditingRecord] = useState<{kind:RecordKind;record:RecordItem}|null>(null);
  const [quickForm, setQuickForm] = useState<"event"|"guests"|"stays"|"transport"|null>(null);
  const [sharingId, setSharingId] = useState("");
  const locationWatch = useRef<number|null>(null);
  const lastLocationPost = useRef(0);
  const [expanded, setExpanded] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authRestoring, setAuthRestoring] = useState(true);
  const [guestView, setGuestView] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const restoreStarted = useRef(false);
  const notificationPermission = typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";

  useEffect(() => {
    try { setTheme(readSavedTheme(window.localStorage)); } catch { setTheme("light"); }
  }, []);

  function toggleTheme() {
    const updated = nextTheme(theme);
    setTheme(updated);
    try { saveTheme(window.localStorage, updated); } catch { /* Keep the active theme for this page load. */ }
  }

  const loadWorkspace = useCallback(async (idToken: string) => {
    setBusy(true); setError("");
    try {
      if (!routeSlug) {
        const hub = await request<{email:string;weddings:WeddingWorkspace[]}>("/api/weddings", idToken);
        if (shouldShowGuestPage(200, hub.weddings.length)) {
          setEmail(hub.email); setWeddings([]); setWedding(null); setIsAdmin(false); setIsMainAdmin(false);
          setTasks([]); setExpenses([]); setEvents([]); setGuestGroups([]); setStays([]); setTransport([]); setPickups([]); setAdminUsers([]); setFamilyMembers([]); setWorkspaceUsers([]); setNotifications([]);
          setToken(""); setGuestView(true); setError("");
          return;
        }
        setEmail(hub.email); setWeddings(hub.weddings); setWedding(null); setIsAdmin(false); setIsMainAdmin(false);
        setTasks([]); setExpenses([]); setEvents([]); setGuestGroups([]); setStays([]); setTransport([]); setAdminUsers([]); setFamilyMembers([]); setWorkspaceUsers([]); setNotifications([]);
        saveToken(idToken); setToken(idToken);
        return;
      }
      const me = await request<{email:string;role:string;isAdmin:boolean;isMainAdmin:boolean;wedding:WeddingWorkspace}>("/api/me", idToken);
      if (me.role === "driver") {
        const [driverRows,pickupRows]=await Promise.all([request<RecordItem[]>("/api/transport",idToken),request<RecordItem[]>("/api/pickups",idToken)]);
        setEmail(me.email); setUserRole(me.role); setIsAdmin(false); setIsMainAdmin(false); setWedding(me.wedding); setTransport(driverRows); setPickups(pickupRows);
        setTasks([]);setExpenses([]);setEvents([]);setGuestGroups([]);setStays([]);setAdminUsers([]);setFamilyMembers([]);setWorkspaceUsers([]);setNotifications([]);setTab("Transport");saveToken(idToken);setToken(idToken);return;
      }
      const [taskRows,eventRows,guestRows,stayRows,transportRows,userRows,notificationRows,pickupRows] = await Promise.all([
        request<RecordItem[]>("/api/tasks", idToken), request<RecordItem[]>("/api/event", idToken),
        request<RecordItem[]>("/api/guests", idToken), request<RecordItem[]>("/api/stays", idToken),
        request<RecordItem[]>("/api/transport", idToken), request<WorkspaceUser[]>("/api/users", idToken),
        request<RecordItem[]>("/api/notifications", idToken),request<RecordItem[]>("/api/pickups",idToken),
      ]);
      setEmail(me.email); setIsAdmin(me.isAdmin); setIsMainAdmin(me.isMainAdmin); setWedding(me.wedding); setTasks(taskRows); setEvents(eventRows);
      setGuestGroups(guestRows); setStays(stayRows); setTransport(transportRows);
      setUserRole(me.role || "family");

      setWorkspaceUsers(userRows); setNotifications(notificationRows);setPickups(pickupRows);
      if (me.isAdmin) {
        const [budgetRows, admins, members] = await Promise.all([request<RecordItem[]>("/api/budget", idToken), request<AdminUser[]>("/api/admins", idToken), request<FamilyMember[]>("/api/family-members", idToken)]);
        setExpenses(budgetRows); setAdminUsers(admins); setFamilyMembers(members);
      } else { setExpenses([]); setAdminUsers([]); setFamilyMembers([]); }
      saveToken(idToken);
      setToken(idToken);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) clearSavedToken();
      if (e instanceof ApiError && shouldShowGuestPage(e.status)) {
        setToken(""); setIsAdmin(false); setIsMainAdmin(false); setWedding(null); setWeddings([]);
        setGuestView(true); setGuestLookup(null); setGuestLookupError(""); setError("");
        return;
      }
      setError(e instanceof Error ? e.message : "Could not sign in.");
    }
    finally { setBusy(false); }
  }, [routeSlug]);

  const initializeGoogle = useCallback(() => {
    if (!CLIENT_ID || !window.google) return;
    const mount = document.getElementById("google-signin");
    if (!mount) return;
    mount.replaceChildren();
    window.google.accounts.id.initialize({ client_id: CLIENT_ID, callback: response => { void request<{token:string}>("/api/auth/session",undefined,{method:"POST",body:JSON.stringify({credential:response.credential})}).then(session=>loadWorkspace(session.token)).catch(e=>setError(e instanceof Error?e.message:"Google sign-in failed.")); } });
    window.google.accounts.id.renderButton(mount, { theme: "outline", size: "large", shape: "pill", text: "continue_with", width: "250" });
  }, [loadWorkspace]);

  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    const savedToken = getSavedToken();
    if (!savedToken) { setAuthRestoring(false); return; }
    void loadWorkspace(savedToken).finally(() => setAuthRestoring(false));
  }, [loadWorkspace]);

  const lastRouteSlug = useRef(routeSlug);
  useEffect(() => {
    if (lastRouteSlug.current === routeSlug) return;
    lastRouteSlug.current = routeSlug;
    setTab("Overview"); setGuestView(false); setExpanded("");
    if (token) void loadWorkspace(token);
  }, [routeSlug, token, loadWorkspace]);
  useEffect(() => { if (!authRestoring && !token) initializeGoogle(); }, [initializeGoogle, authRestoring, token]);
  useEffect(() => { void request<RecordItem[]>("/api/public/events").then(setEvents).catch(() => setEvents([])); }, []);
  useEffect(() => () => { if (locationWatch.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(locationWatch.current); }, []);
  useEffect(() => {
    if (!token || !routeSlug) return;
    const refreshAccess = async () => {
      try {
        const me = await request<{email:string;isAdmin:boolean;isMainAdmin:boolean;wedding:WeddingWorkspace}>("/api/me", token);
        setIsAdmin(me.isAdmin); setIsMainAdmin(me.isMainAdmin); setWedding(me.wedding);
        const [taskRows, userRows] = await Promise.all([request<RecordItem[]>("/api/tasks", token), request<WorkspaceUser[]>("/api/users", token)]);
        setTasks(previous => taskRows.map(row => row.id === expanded ? { ...row, details: previous.find(item => item.id === row.id)?.details ?? row.details } : row));
        setWorkspaceUsers(userRows);
        if (!me.isAdmin) { setExpenses([]); setAdminUsers([]); if (tab === "Admin access" || tab === "Budget") setTab("Overview"); }
      } catch { /* Keep the current view during a temporary network interruption. */ }
    };
    const interval = window.setInterval(() => void refreshAccess(), 20000);
    return () => window.clearInterval(interval);
  }, [token, tab, expanded, routeSlug]);

  useEffect(() => {
    if (!token || !routeSlug) return;
    let firstLoad = true;
    const refreshNotifications = async () => {
      try {
        const rows = await request<RecordItem[]>("/api/notifications", token);
        setNotifications(previous => {
          if (!firstLoad && "Notification" in window && Notification.permission === "granted") {
            const seen = new Set(previous.map(item => item.id));
            rows.filter(item => !seen.has(item.id)).forEach(item => new Notification(item.title, { body: item.details || "Wedding workspace update" }));
          }
          firstLoad = false;
          return rows;
        });
      } catch { /* Keep the current feed during a temporary network interruption. */ }
    };
    void refreshNotifications();
    const interval = window.setInterval(() => void refreshNotifications(), 20000);
    return () => window.clearInterval(interval);
  }, [token, routeSlug]);

  const filteredTasks = useMemo(() => tasks.filter(t => `${t.title} ${t.area || ""} ${t.owner || ""} ${t.assigneeEmail || ""} ${t.createdBy || ""} ${t.details || ""}`.toLowerCase().includes(query.toLowerCase()) && (statusFilter === "All tasks" || t.status === statusFilter)), [tasks, query, statusFilter]);
  const dueReminders = useMemo(() => tasks.filter(task => task.status !== "Done" && task.dueAt && new Date(task.dueAt).getTime() <= Date.now() + 7 * 86400000).sort((a,b)=>new Date(a.dueAt!).getTime()-new Date(b.dueAt!).getTime()), [tasks]);
  const budgetRoots = useMemo(() => getBudgetRoots(expenses), [expenses]);
  const budgetChildren = useMemo(() => getBudgetChildren(expenses), [expenses]);
  const matchingBudgetRoots = useMemo(() => filterBudgetRoots(expenses, query), [expenses, query]);
  const total = useMemo(() => getBudgetTotal(expenses), [expenses]);

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try {
      const due = data.get("dueAt")?.toString();
      const saved = await request<RecordItem>("/api/tasks", token, { method: "POST", body: JSON.stringify({ title: data.get("title"), area: data.get("area"), owner: data.get("owner"), assigneeEmail: data.get("assigneeEmail") || undefined, status: "To do", details: data.get("details"), dueAt: due ? `${due}T12:00:00Z` : undefined }) });
      setTasks(rows => [saved, ...rows]); setShowTaskForm(false); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save task."); }
  }

  async function saveTaskDetails(task: RecordItem, details: string) {
    try {
      await request(`/api/tasks/${task.id}`, token, { method: "PATCH", body: JSON.stringify({ details }) });
      setTasks(rows => rows.map(row => row.id === task.id ? { ...row, details, updatedAt: new Date().toISOString() } : row));
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update task notes."); }
  }

  async function createNotification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try {
      const saved = await request<RecordItem>("/api/notifications", token, { method: "POST", body: JSON.stringify({ title: data.get("title"), details: data.get("details"), notificationKind: data.get("notificationKind"), status: "New" }) });
      setNotifications(rows => [saved, ...rows]); setShowNotificationForm(false); setError("");
      if ("Notification" in window && Notification.permission === "granted") new Notification(saved.title, { body: saved.details || "Wedding workspace update" });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send the notification."); }
  }

  function updateLocalRecord(kind: RecordKind, id: string, patch: Partial<RecordItem>) {
    const update = (rows: RecordItem[]) => rows.map(row => row.id === id ? { ...row, ...patch } : row);
    if (kind === "task") setTasks(update);
    if (kind === "budget") setExpenses(update);
    if (kind === "event") setEvents(update);
    if (kind === "guests") setGuestGroups(update);
    if (kind === "stays") setStays(update);
    if (kind === "transport") setTransport(update);
    if (kind === "pickups") setPickups(update);
    if (kind === "notifications") setNotifications(update);
  }

  function removeLocalRecord(kind: RecordKind, id: string) {
    const remove = (rows: RecordItem[]) => rows.filter(row => row.id !== id);
    if (kind === "task") setTasks(remove);
    if (kind === "budget") setExpenses(remove);
    if (kind === "event") setEvents(remove);
    if (kind === "guests") setGuestGroups(remove);
    if (kind === "stays") setStays(remove);
    if (kind === "transport") setTransport(remove);
    if (kind === "pickups") setPickups(remove);
    if (kind === "notifications") setNotifications(remove);
  }

  async function saveRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editingRecord) return;
    const { kind, record } = editingRecord; const data = new FormData(event.currentTarget);
    const dueAt = data.get("dueAt")?.toString();
    const startsAt = data.get("startsAt")?.toString();
    const endsAt = data.get("endsAt")?.toString();
    const billFile=data.get("billFile");
    if(billFile instanceof File&&billFile.size>3*1024*1024){setError("Bill attachment must be 3 MB or smaller.");return;}
    const billData=billFile instanceof File&&billFile.size?await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(billFile);}):undefined;
    const patch: Omit<Partial<RecordItem>,"dueAt"|"startsAt"|"endsAt"|"arrivalAt"> & {dueAt?:string|null;startsAt?:string|null;endsAt?:string|null;arrivalAt?:string|null} = {
      title: data.get("title")?.toString() || record.title,
      area: data.get("area")?.toString(), owner: data.get("owner")?.toString(),
      guestName:data.get("guestName")?.toString(),guestPhone:data.get("guestPhone")?.toString(),guestInstructions:data.get("guestInstructions")?.toString(),arrivalType:data.get("arrivalType")?.toString(),arrivalNumber:data.get("arrivalNumber")?.toString(),pickupLocation:data.get("pickupLocation")?.toString(),assignedCar:data.get("assignedCar")?.toString(),
      assigneeEmail: data.get("assigneeEmail")?.toString(), status: data.get("status")?.toString(),
      details: data.get("details")?.toString(), event: data.get("event")?.toString(),
      venue: data.get("venue")?.toString(), notificationKind: data.get("notificationKind")?.toString(),
      dueAt: dueAt ? new Date(`${dueAt}T12:00:00`).toISOString() : null,
      startsAt: startsAt ? new Date(startsAt).toISOString() : null,
      endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      arrivalAt:data.get("arrivalAt")?.toString()?new Date(data.get("arrivalAt")!.toString()).toISOString():null,
      amount: kind === "budget" ? Number(data.get("amount") || 0) : record.amount,
      vendor:data.get("vendor")?.toString(),paymentStatus:data.get("paymentStatus")?.toString(),paidAmount:Number(data.get("paidAmount")||0),billUrl:data.get("billUrl")?.toString(),...(billData?{billData,billFileName:billFile instanceof File?billFile.name:""}:{}),
    };
    const collection = kind === "task" ? "tasks" : kind;
    try {
      await request(`/api/${collection}/${record.id}`, token, { method: "PATCH", body: JSON.stringify(patch) });
      const localPatch = Object.fromEntries(Object.entries(patch).map(([key,value])=>[key,value===null?undefined:value])) as Partial<RecordItem>;
      updateLocalRecord(kind, record.id, { ...localPatch, updatedAt: new Date().toISOString() });
      setEditingRecord(null); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save changes."); }
  }

  async function deleteRecord(kind: RecordKind, record: RecordItem) {
    const childCount = kind === "budget" && !record.parentId ? expenses.filter(item => item.parentId === record.id).length : 0;
    if (!window.confirm(`Delete “${record.title}”${childCount ? ` and its ${childCount} sub-budget detail${childCount===1?"":"s"}` : ""}? This cannot be undone.`)) return;
    const collection = kind === "task" ? "tasks" : kind;
    try {
      await request(`/api/${collection}/${record.id}`, token, { method: "DELETE" });
      if (kind === "budget" && !record.parentId) setExpenses(rows => rows.filter(row => row.id !== record.id && row.parentId !== record.id));
      else removeLocalRecord(kind, record.id);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not delete this record."); }
  }

  async function toggleStayCheckIn(stay: RecordItem) {
    const checkedIn = !stay.checkedIn;
    try {
      await request(`/api/stays/${stay.id}`, token, { method: "PATCH", body: JSON.stringify({ checkedIn }) });
      updateLocalRecord("stays", stay.id, { checkedIn, checkedInAt: checkedIn ? new Date().toISOString() : undefined, checkedInBy: checkedIn ? email : undefined });
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update guest check-in."); }
  }

  async function enableBrowserNotifications() {
    if (!("Notification" in window)) { setError("This browser does not support desktop notifications."); return; }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") setError("Browser notifications were not enabled. The in-app notification feed will still work.");
  }

  async function toggleTask(task: RecordItem) {
    const status = task.status === "Done" ? "To do" : "Done";
    setTasks(rows => rows.map(row => row.id === task.id ? { ...row, status } : row));
    setError("");
    try {
      await request(`/api/tasks/${task.id}`, token, { method: "PATCH", body: JSON.stringify({ status }) });
    } catch (e) {
      setTasks(rows => rows.map(row => row.id === task.id ? { ...row, status: task.status } : row));
      setError(e instanceof Error ? e.message : "Could not update task.");
    }
  }

  async function createBudgetItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    try {
      const file=data.get("billFile");if(file instanceof File&&file.size>3*1024*1024)throw new Error("Bill attachment must be 3 MB or smaller.");
      const billData=file instanceof File&&file.size?await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);}):undefined;
      const saved = await request<RecordItem>("/api/budget", token, { method: "POST", body: JSON.stringify({ title: data.get("title"), event: data.get("event"), owner: data.get("owner"),vendor:data.get("vendor"),amount: Number(data.get("amount")),paidAmount:Number(data.get("paidAmount")||0),paymentStatus:data.get("paymentStatus"),billUrl:data.get("billUrl"),billData,billFileName:file instanceof File?file.name:"" }) });
      setExpenses(rows => [saved, ...rows]); setShowBudgetForm(false); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save budget item."); }
  }

  async function createSubBudgetItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!subBudgetParent) return;
    const data = new FormData(event.currentTarget);
    try {
      const saved = await request<RecordItem>("/api/budget", token, { method: "POST", body: JSON.stringify({ title: data.get("title"), owner: data.get("owner"), details: data.get("details"), amount: Number(data.get("amount")), parentId: subBudgetParent.id }) });
      setExpenses(rows => [saved, ...rows]); setSubBudgetParent(null); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save sub-budget detail."); }
  }

  async function grantAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data=new FormData(event.currentTarget);
    try {
      const email = data.get("email");
      if (accessRole === "admin") {
        const created=await request<AdminUser>("/api/admins",token,{method:"POST",body:JSON.stringify({email})});
        setAdminUsers(rows=>[...rows,created].sort((a,b)=>a.email.localeCompare(b.email)));
      } else {
      const created=await request<FamilyMember>("/api/family-members",token,{method:"POST",body:JSON.stringify({email,role:data.get("role")||"family"})});
        setFamilyMembers(rows=>[...rows.filter(row=>row.email!==created.email),created].sort((a,b)=>a.email.localeCompare(b.email)));
      }
      setShowAdminForm(false); setError("");
    } catch(e) { setError(e instanceof Error?e.message:"Could not grant access."); }
  }

  async function createWedding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const created = await request<WeddingWorkspace>("/api/weddings", token, { method: "POST", body: JSON.stringify({ name: data.get("name"), heading: data.get("heading"), mainAdminEmail: data.get("mainAdminEmail") }) });
      setWeddings(rows => [...rows, created]);
      setShowWeddingForm(false);
      router.push(weddingWorkspacePath(created.slug));
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create wedding workspace."); }
  }

  async function transferMainAdmin(user: AdminUser) {
    if (!window.confirm(`Make ${user.email} the main admin for ${wedding?.name || "this wedding"}?`)) return;
    try {
      await request(`/api/weddings/${encodeURIComponent(routeSlug)}/main-admin`, token, { method: "PATCH", body: JSON.stringify({ email: user.email }) });
      const updated = wedding ? { ...wedding, mainAdminEmail: user.email } : wedding;
      setWedding(updated);
      setIsMainAdmin(user.email.toLowerCase() === email.toLowerCase());
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not transfer main admin access."); }
  }

  async function saveWeddingSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wedding) return;
    const data = new FormData(event.currentTarget);
    try {
      const updated = await request<WeddingWorkspace>(`/api/weddings/${encodeURIComponent(routeSlug)}`, token, { method: "PATCH", body: JSON.stringify({ name: data.get("name"), heading: data.get("heading") }) });
      setWedding(updated); setShowWorkspaceSettings(false); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update wedding settings."); }
  }

  async function revokeFamilyAccess(member: FamilyMember) {
    if (!window.confirm(`Remove wedding workspace access for ${member.email}?`)) return;
    try {
      await request(`/api/family-members/${encodeURIComponent(member.email)}`,token,{method:"DELETE"});
      setFamilyMembers(rows=>rows.filter(row=>row.email!==member.email));
      if (member.email.toLowerCase()===email.toLowerCase()) signOut();
    } catch(e) { setError(e instanceof Error?e.message:"Could not remove family access."); }
  }

  async function revokeAdmin(user: AdminUser) {
    if (!window.confirm(`Remove admin access for ${user.email}?`)) return;
    try {
      await request(`/api/admins/${encodeURIComponent(user.email)}`,token,{method:"DELETE"});
      setAdminUsers(rows=>rows.filter(row=>row.email!==user.email));
      if (user.email.toLowerCase()===email.toLowerCase()) signOut();
    } catch(e) { setError(e instanceof Error?e.message:"Could not remove admin access."); }
  }

  async function createPlanningRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!quickForm) return;
    const data = new FormData(event.currentTarget); const kind = quickForm;
    const starts = data.get("startsAt")?.toString(); const ends = data.get("endsAt")?.toString();
    const record = { title: data.get("title"), event: data.get("event"), owner: data.get("owner"), status: data.get("status"), venue: data.get("venue"), area:data.get("area"),guestInstructions:data.get("guestInstructions"),arrivalType:data.get("arrivalType"),arrivalNumber:data.get("arrivalNumber"),arrivalAt:data.get("arrivalAt")?.toString()?new Date(data.get("arrivalAt")!.toString()).toISOString():undefined,pickupLocation:data.get("pickupLocation"),assignedCar:data.get("assignedCar"),details: data.get("details"), startsAt: starts ? new Date(starts).toISOString() : undefined, endsAt: ends ? new Date(ends).toISOString() : undefined };
    try {
      const saved = await request<RecordItem>(`/api/${kind === "event" ? "event" : kind}`, token, { method: "POST", body: JSON.stringify(record) });
      if (kind === "event") setEvents(rows => [...rows,saved].sort((a,b)=>new Date(a.startsAt||0).getTime()-new Date(b.startsAt||0).getTime()));
      if (kind === "guests") setGuestGroups(rows=>[saved,...rows]);
      if (kind === "stays") setStays(rows=>[saved,...rows]);
      if (kind === "transport") setTransport(rows=>[saved,...rows]);
      setQuickForm(null); setError("");
    } catch(e) { setError(e instanceof Error?e.message:"Could not save details."); }
  }

  async function lookupGuest(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data=new FormData(event.currentTarget); setGuestLookup(null); setGuestLookupError("");
    const arrivalAt=data.get("arrivalAt")?.toString();
    try { const result=await request<GuestLookup>("/api/public/guest-lookup",undefined,{method:"POST",body:JSON.stringify({name:data.get("name"),arrivalNumber:data.get("arrivalNumber"),arrivalAt:arrivalAt?new Date(arrivalAt).toISOString():""})}); setGuestLookup(result); }
    catch(e) { setGuestLookupError(e instanceof Error?e.message:"Could not find your stay details."); }
  }

  async function createPickup(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const data=new FormData(event.currentTarget);const arrival=data.get("arrivalAt")?.toString();
    const record={title:data.get("guestName"),guestName:data.get("guestName"),guestPhone:data.get("guestPhone"),arrivalType:data.get("arrivalType"),arrivalNumber:data.get("arrivalNumber"),arrivalAt:arrival?new Date(arrival).toISOString():undefined,pickupLocation:data.get("pickupLocation"),assignedCar:data.get("assignedCar"),owner:data.get("owner"),status:"Planned",details:data.get("details")};
    try { const saved=await request<RecordItem>("/api/pickups",token,{method:"POST",body:JSON.stringify(record)});setPickups(rows=>[saved,...rows]);setShowPickupForm(false);setError(""); }
    catch(e){setError(e instanceof Error?e.message:"Could not save pickup details.");}
  }

  function startLocationSharing(item: RecordItem) {
    if (!navigator.geolocation) { setError("This device/browser does not support location sharing."); return; }
    if (locationWatch.current !== null) navigator.geolocation.clearWatch(locationWatch.current);
    setSharingId(item.id); lastLocationPost.current=0;
    locationWatch.current=navigator.geolocation.watchPosition(async position=>{
      if (Date.now()-lastLocationPost.current<12000) return;
      lastLocationPost.current=Date.now();
      const coords={latitude:position.coords.latitude,longitude:position.coords.longitude};
      try {
        await request(`/api/transport/${item.id}`,token,{method:"PATCH",body:JSON.stringify(coords)});
        setTransport(rows=>rows.map(row=>row.id===item.id?{...row,...coords,updatedAt:new Date().toISOString()}:row));
      } catch(e) { setError(e instanceof Error?e.message:"Could not update location."); }
    },e=>setError(e.message),{enableHighAccuracy:true,maximumAge:10000,timeout:15000});
  }

  function stopLocationSharing() { if(locationWatch.current!==null&&navigator.geolocation)navigator.geolocation.clearWatch(locationWatch.current); locationWatch.current=null; setSharingId(""); }

  async function changeDriverStatus(item: RecordItem, status: string) {
    try { await request(`/api/transport/${item.id}`,token,{method:"PATCH",body:JSON.stringify({status})}); setTransport(rows=>rows.map(row=>row.id===item.id?{...row,status}:row)); }
    catch(e) { setError(e instanceof Error?e.message:"Could not update driver status."); }
  }

  function signOut() { stopLocationSharing(); clearSavedToken(); setToken(""); setEmail(""); setIsAdmin(false); setIsMainAdmin(false); setWedding(null); setWeddings([]); setTasks([]); setExpenses([]); setTransport([]); setWorkspaceUsers([]); setNotifications([]); setTab("Overview"); }

  const navigationItems = userRole === "driver" ? ["Transport"] : ["Overview", "Tasks", "Budget", "Guests & stays", "Transport", "Schedule", "Notifications", ...(isAdmin?["Admin access"]:[])];
  const recordActions = (kind: RecordKind, record: RecordItem) => (isAdmin||kind==="task")?<div className="record-actions"><button type="button" className="text-link" onClick={()=>setEditingRecord({kind,record})}>Edit</button><button type="button" className="record-delete" onClick={()=>void deleteRecord(kind,record)}>Delete</button></div>:null;
  const taskRows = (limit = filteredTasks.length) => <div className="task-list">{filteredTasks.slice(0,limit).map(task=><article className={`task-row ${expanded===task.id?"open":""}`} key={task.id}><button type="button" className={`task-check ${task.status==="Done"?"is-checked":""}`} aria-label={task.status==="Done"?"Mark task incomplete":"Mark task complete"} aria-pressed={task.status==="Done"} onClick={()=>void toggleTask(task)}>{task.status==="Done"?"✓":""}</button><button className="task-copy" onClick={()=>setExpanded(expanded===task.id?"":task.id)}><span className={`task-title ${task.status==="Done"?"completed":""}`}>{task.title}</span><span className="task-meta"><span className="area-tag">{task.area||"Family"}</span><span className="task-owner"><span className="owner-avatar">{(task.createdBy||task.owner||"?")[0]}</span>{task.createdBy||task.owner||"Added by family"}</span><span className="task-assignee">{task.assigneeEmail?`Assigned to ${task.assigneeEmail}`:"Unassigned"}</span><span className="task-date">◷ {shortDate(task.dueAt)}</span></span></button>{task.dueAt&&<a className="text-link" target="_blank" rel="noreferrer" href={googleCalendarURL(task.title,task.dueAt,task.details||"")}>Add to Calendar</a>}<span className={`status ${(task.status||"To do").toLowerCase().replace(" ","-")}`}>{task.status||"To do"}</span>{recordActions("task",task)}{expanded===task.id&&<div className="task-note-editor"><label htmlFor={`notes-${task.id}`}>Description and shared notes</label><textarea id={`notes-${task.id}`} value={task.details||""} placeholder="Add the full task description, updates, vendor details or checklist…" onChange={e=>setTasks(rows=>rows.map(row=>row.id===task.id?{...row,details:e.target.value}:row))}/><div className="task-note-actions"><small>Everyone with workspace access can view and update these notes.</small><button className="button-primary" onClick={()=>void saveTaskDetails(task,task.details||"")}>Save notes</button></div></div>}</article>)}</div>;

  if (guestView) return <main className="guest-page" data-theme={theme}><button className="guest-back" onClick={() => setGuestView(false)}>← Family workspace</button><div className="guest-content"><div className="guest-kicker">{wedding?.heading || wedding?.name || "Wedding celebration"}</div><h1>Celebrating<br /><i>together.</i></h1><p className="guest-intro">We can’t wait to celebrate with you. Here’s where to be and what’s coming up.</p><section className="guest-event guest-lookup-card"><form className="guest-lookup-form" onSubmit={lookupGuest}><div className="guest-lookup-heading"><strong>Find your room and pickup</strong><p>Enter your details as shared with the family.</p></div><label>Full name<input name="name" autoComplete="name" placeholder="As on your invitation" required minLength={3}/></label><label>Train / flight number<input name="arrivalNumber" placeholder="e.g. 12951 or AI 634" required minLength={3}/></label><label className="guest-arrival-field">Arrival date and time<input name="arrivalAt" type="datetime-local" required/></label><button className="button-primary" type="submit">Find my details <span aria-hidden="true">→</span></button></form>{guestLookupError&&<p className="guest-lookup-error" role="alert">{guestLookupError}</p>}{guestLookup&&<div className="event-main guest-lookup-result"><strong>{guestLookup.name}</strong><span>{guestLookup.hotel||"Hotel details pending"}{guestLookup.room?` · Room ${guestLookup.room}`:""}</span><span>{guestLookup.arrivalAt?`Arrival ${new Date(guestLookup.arrivalAt).toLocaleString("en-IN")}`:""}</span><span>{guestLookup.pickupLocation?`Pickup: ${guestLookup.pickupLocation}`:""}{guestLookup.assignedCar?` · Car ${guestLookup.assignedCar}`:""}{guestLookup.driver?` · Driver ${guestLookup.driver}`:""}</span><span>{guestLookup.stayDetails||""}</span></div>}</section>{events.length ? events.filter(e => e.startsAt).sort((a,b) => new Date(a.startsAt!).getTime()-new Date(b.startsAt!).getTime()).map(e => <article className="guest-event" key={e.id}><span className="event-date">{shortDate(e.startsAt).toUpperCase()}</span><div className="event-main"><strong>{e.title}</strong><span>{new Date(e.startsAt!).toLocaleTimeString("en-IN", {hour:"numeric",minute:"2-digit"})}</span><span>{e.venue || "Venue to be announced"}</span></div><a className="calendar-link" target="_blank" rel="noreferrer" href={googleCalendarEventURL(e.title,e.startsAt!,e.endsAt,e.venue||"",e.details||"")}>Add to Calendar</a></article>) : <div className="guest-event"><div className="event-main"><strong>Schedule coming soon</strong><span>The family will share event times and venues here.</span></div></div>}<p className="guest-footer">Please contact family for travel and stay assistance.</p></div></main>;

  if (authRestoring) return <main className="login-screen"><div className="login-card"><div className="brand-mark login-mark">S</div><div className="guest-kicker">WEDDING WORKSPACE</div><p>Restoring your family workspace…</p></div></main>;

  if (!token) return <><Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={initializeGoogle} /><main className="login-screen"><div className="login-card"><div className="brand-mark login-mark">S</div><div className="guest-kicker">WEDDING WORKSPACE</div><h1>Plan the day,<br /><i>together.</i></h1><p>Tasks, plans and family details in one shared place.</p><div id="google-signin" className="google-signin" /><p className="oauth-origin-note">This app is signing in from <code>{typeof window!=="undefined"?window.location.origin:""}</code>. Add this exact origin to the Google OAuth client’s Authorized JavaScript origins if sign-in reports an origin mismatch.</p>{!CLIENT_ID && <p className="setup-note">Add NEXT_PUBLIC_GOOGLE_CLIENT_ID to frontend/.env.local to enable family sign-in.</p>}{busy && <p className="setup-note">Signing you in…</p>}{error && <p className="error-note">{error}</p>}<button className="guest-access" onClick={() => setGuestView(true)}>View guest schedule →</button></div></main></>;

  if (!routeSlug) return <main className="workspace-hub" data-theme={theme}><header className="hub-topbar"><div className="brand"><div className="brand-mark">S</div><div><b>shaadi<span>hq</span></b><small>WEDDING WORKSPACES</small></div></div><div className="hub-actions"><button className="theme-toggle" type="button" aria-pressed={theme === "dark"} onClick={toggleTheme}>{theme === "dark" ? "☀ Light mode" : "☾ Dark mode"}</button><button className="user-card user-button" onClick={signOut}><div className="avatar">{email.slice(0,1).toUpperCase()}</div><div><b>{email}</b><small>Sign out</small></div></button></div></header><section className="hub-content"><div className="eyebrow"><span className="eyebrow-star">✳</span> YOUR FAMILY CELEBRATIONS</div><h1>Wedding <i>workspaces.</i></h1><p>Each wedding has its own schedule, tasks, rooms, budget and admin team.</p>{error&&<div className="error-banner">{error}<button onClick={()=>setError("")}>×</button></div>}<div className="hub-heading"><div><h2>Your weddings</h2><span>{weddings.length} {weddings.length===1?"workspace":"workspaces"}</span></div><button className="button-primary" onClick={()=>setShowWeddingForm(true)}>＋ Add wedding</button></div>{weddings.length?<div className="wedding-grid">{weddings.map(item=><article className="wedding-card" key={item.slug}><div className="wedding-card-mark">✳</div><div className="eyebrow">FAMILY WORKSPACE</div><h3>{item.name}</h3><p>{item.heading}</p><div className="wedding-card-admin">Main admin <b>{item.mainAdminEmail||"Not assigned"}</b></div><button className="button-primary" onClick={()=>router.push(weddingWorkspacePath(item.slug))}>Open workspace →</button></article>)}</div>:<section className="empty-state hub-empty"><h2>No wedding workspaces yet</h2><p>Create a wedding page to start organizing its schedule, family tasks, rooms and budget.</p><button className="button-primary" onClick={()=>setShowWeddingForm(true)}>＋ Create wedding</button></section>}</section>{showWeddingForm&&<div className="modal-scrim" onClick={()=>setShowWeddingForm(false)}><form className="modal" onSubmit={createWedding} onClick={e=>e.stopPropagation()}><button type="button" className="modal-close" onClick={()=>setShowWeddingForm(false)}>×</button><div className="eyebrow">NEW FAMILY WORKSPACE</div><h2>Create a wedding page</h2><p>This starts with separate records and admin access. You and the main admin email will both be admins.</p><label>Wedding name<input name="name" autoFocus required placeholder="Upadhyay Wedding"/></label><label>Page heading<input name="heading" placeholder="The Upadhyay Wedding"/></label><label>Main admin Gmail<input name="mainAdminEmail" type="email" required defaultValue={email}/></label><div className="modal-actions"><button type="button" className="button-quiet" onClick={()=>setShowWeddingForm(false)}>Cancel</button><button className="button-primary" type="submit">Create workspace</button></div></form></div>}</main>;

  return <div className="app-shell" data-theme={theme}><Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={initializeGoogle} />
    {mobileNavOpen&&<button className="mobile-nav-scrim" aria-label="Close navigation menu" onClick={()=>setMobileNavOpen(false)} />}
    <aside className={`sidebar${mobileNavOpen?" mobile-open":""}`}><div className="brand"><div className="brand-mark">S</div><div><b>shaadi<span>hq</span></b><small>{wedding?.heading||wedding?.name}</small></div><button className="mobile-nav-close" aria-label="Close navigation" onClick={()=>setMobileNavOpen(false)}>×</button></div><button className="wedding-switch" onClick={()=>router.push("/")}><span className="mini-crest" aria-hidden="true"></span><span>{wedding?.name||"Wedding"}<small>Switch workspace</small></span><span className="chevron" aria-hidden="true"></span></button><div className="nav-label">WORKSPACE</div><nav>{navigationItems.map(item=><button key={item} className={"nav-item "+(tab===item?"selected":"")} onClick={()=>{setTab(item);setMobileNavOpen(false)}}><span className="nav-icon">{{"Overview":"O","Tasks":"T","Budget":"B","Guests & stays":"G","Transport":"C","Schedule":"S","Notifications":"N","Admin access":"A"}[item]}</span>{item}{item==="Tasks"&&<span className="nav-count">{tasks.filter(t=>t.status!=="Done").length}</span>}{item==="Notifications"&&notifications.length>0&&<span className="nav-count">{notifications.length}</span>}</button>)}</nav><div className="sidebar-spacer"/>{userRole!=="driver"&&<button className="guest-link" onClick={()=>{setGuestView(true);setMobileNavOpen(false)}}><span>↗</span> Preview guest page</button>}<button className="user-card user-button" onClick={signOut}><div className="avatar">{email.slice(0,1).toUpperCase()}</div><div><b>{email}</b><small>{isAdmin?"Family admin":userRole==="driver"?"Driver access":"Family member"} · Sign out</small></div></button></aside>
    <main className="main-area"><header className="topbar"><button className="mobile-nav-toggle" aria-label="Open navigation menu" aria-expanded={mobileNavOpen} onClick={()=>setMobileNavOpen(true)}><span></span><span></span><span></span></button><div className="crumb">{wedding?.name||"Wedding"} <span>/</span> <b>{tab}</b></div><div className="top-actions"><button className="theme-toggle" type="button" aria-pressed={theme === "dark"} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={toggleTheme}><span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>{theme === "dark" ? "Light mode" : "Dark mode"}</button><button className="help-button" onClick={()=>setGuestView(true)}>Guest page ↗</button><div className="top-avatar">{email.slice(0,1).toUpperCase()}</div></div></header>
      <div className="page-wrap"><section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-star">✳</span> {wedding?.heading||wedding?.name||"YOUR WEDDING, IN ONE PLACE"}</div><h1>{tab==="Overview"?<>A little more <i>organized.</i></>:tab}</h1><p className="subheading">Shared with the family <span className="sub-dot">·</span> {email}</p></div><div className="welcome-actions"><button className="button-quiet" onClick={()=>setGuestView(true)}>◉ Guest view</button>{tab==="Budget"&&isAdmin&&<button className="button-primary" onClick={()=>setShowBudgetForm(true)}>＋ Add expense</button>}</div></section>
      {error&&<div className="error-banner">{error}<button onClick={()=>setError("")}>×</button></div>}
      {tab==="Overview"&&<><div className="summary-grid"><article className="summary-card"><div className="card-top"><span className="card-label">OPEN TASKS</span><span className="card-symbol task-symbol">☑</span></div><div className="metric">{tasks.filter(t=>t.status!=="Done").length}<span className="metric-small"> tasks</span></div><div className="metric-foot">Shared family checklist</div></article><article className="summary-card"><div className="card-top"><span className="card-label">NEXT DEADLINE</span><span className="card-symbol calendar-symbol">▦</span></div><div className="metric metric-date">{shortDate(dueReminders[0]?.dueAt)}</div><div className="metric-foot">{dueReminders[0]?.title||"No due tasks this week"}</div></article><article className="summary-card"><div className="card-top"><span className="card-label">UPCOMING EVENTS</span><span className="card-symbol home-symbol">⌂</span></div><div className="metric">{events.length}<span className="metric-small"> events</span></div><div className="metric-foot">Schedule shared with guests</div></article><article className="summary-card budget-summary"><div className="card-top"><span className="card-label">BUDGET TRACKED</span><span className="card-label">{isAdmin?"ADMIN":"PRIVATE"}</span></div><div className="metric">{isAdmin?inr(total):"••••••"}</div><div className="metric-foot">{isAdmin?`${expenses.length} saved items`:"Visible to admins only"}</div></article></div><div className="content-grid overview-grid"><section className="panel overview-priority"><div className="panel-heading"><div><div className="panel-title">Priority this week <span className="count-pill">{dueReminders.length}</span></div><p>Tasks with a due date in the next seven days</p></div><button className="text-link" onClick={()=>setTab("Tasks")}>All tasks →</button></div>{dueReminders.slice(0,5).map(task=><article className="overview-task" key={task.id}><span className="date-badge"><b>{task.dueAt?new Date(task.dueAt).getDate():"—"}</b><small>{shortDate(task.dueAt).split(" ")[1]?.toUpperCase()}</small></span><div><b>{task.title}</b><small>{task.assigneeEmail?`Assigned to ${task.assigneeEmail}`:"Unassigned"} · {shortDate(task.dueAt)}</small></div><button className="text-link" onClick={()=>{setTab("Tasks");setExpanded(task.id)}}>Open →</button></article>)}{dueReminders.length===0&&<div className="empty-mini">Add dates to important pickups and family tasks to see them here.</div>}<button className="add-row" onClick={()=>setShowTaskForm(true)}>＋ Add a family task</button></section><aside className="right-column"><section className="panel today-panel"><div className="panel-heading"><div><div className="panel-title">Next up</div><p>Upcoming family schedule</p></div><span className="sun-icon">☼</span></div>{events.filter(e=>e.startsAt).sort((a,b)=>new Date(a.startsAt!).getTime()-new Date(b.startsAt!).getTime()).slice(0,3).map(e=><div className="upcoming-item" key={e.id}><div className="date-badge"><b>{new Date(e.startsAt!).getDate()}</b><small>{new Date(e.startsAt!).toLocaleDateString("en-IN",{month:"short"}).toUpperCase()}</small></div><div><b>{e.title}</b><small>{new Date(e.startsAt!).toLocaleTimeString("en-IN",{hour:"numeric",minute:"2-digit"})} · {e.venue||"Venue TBD"}</small></div></div>)}{events.length===0&&<div className="empty-mini">Schedule details will appear here.</div>}<button className="calendar-link" onClick={()=>setTab("Schedule")}>Open schedule →</button></section><section className="quote-card"><span>“</span><p>Many hands make<br/>the day feel lighter.</p><small>A NOTE FOR THE FAMILY</small><div className="quote-flower">✿</div></section></aside></div></>}
      {tab==="Tasks"&&<section className="panel task-manager-panel"><div className="panel-heading"><div><div className="panel-title">Task manager <span className="count-pill">{filteredTasks.length} shown · {tasks.length} total</span></div><p>Assign work, keep the complete description with it, and edit shared notes.</p></div><button className="button-primary" onClick={()=>setShowTaskForm(true)}>＋ Add a task</button></div><div className="task-toolbar"><div className="search-box"><span>⌕</span><input aria-label="Search tasks" placeholder="Search tasks, assignees, descriptions…" value={query} onChange={e=>setQuery(e.target.value)}/></div><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} aria-label="Filter tasks"><option>All tasks</option><option>To do</option><option>In progress</option><option>Done</option></select></div>{taskRows()}{filteredTasks.length===0&&<div className="empty-state">{query?"No matching tasks. Try another search.":"No tasks yet. Add the first task for the family."}</div>}</section>}      {tab==="Budget"&&(isAdmin?<section className="panel secondary-panel"><div className="panel-heading"><div><div className="panel-title">Wedding budget <span className="count-pill">{budgetRoots.length} sections · {budgetChildren.length} spend details</span></div><p>Private to family admins · add smaller costs inside each budget item</p></div><button className="button-primary" onClick={()=>setShowBudgetForm(true)}>＋ Add expense</button></div><div className="budget-total"><span>KNOWN SPEND</span><b>{inr(total)}</b><small>Sub-spend details are shown as a breakdown and are not included in known spend.</small></div><div className="search-box wide-search"><span>⌕</span><input placeholder="Search DJ, pyros, flowers, owner…" value={query} onChange={e=>setQuery(e.target.value)}/></div>{matchingBudgetRoots.map(root=>{const children=budgetChildren.filter(child=>child.parentId===root.id);const rootMatches=matchesBudgetRecord(root,query);const shownChildren=query&&!rootMatches?children.filter(child=>matchesBudgetRecord(child,query)):children;const detailTotal=children.reduce((sum,child)=>sum+(child.amount||0),0);return <div className="budget-root-block" key={root.id}><div className="expense-row"><div className="budget-item-name"><b>{root.title}</b><small>Spent by {getBudgetSpender(root)}</small></div><span>{root.event||"Other"}</span><span>{root.owner||"Unassigned"}</span><strong>{inr(root.amount||0)}</strong><small>{root.paymentStatus||"Payment status not set"}{root.paidAmount!==undefined?` · paid ${inr(root.paidAmount)}`:""} · balance {inr(getBudgetBalance(root))}</small>{(root.billData||root.billUrl)&&<a href={root.billData||root.billUrl} target="_blank" rel="noreferrer">View bill</a>}{recordActions("budget",root)}</div>{children.length>0&&<div className="sub-budget-list"><div className="sub-budget-heading"><span>SPEND DETAILS</span><small>Details subtotal (excluded) · {inr(detailTotal)}</small></div>{shownChildren.map(child=><div className="sub-budget-row" key={child.id}><div><b>{child.title}</b><small>{[child.owner,child.details].filter(Boolean).join(" / ")||"No extra details"}</small><small className="budget-spender">Spent by {getBudgetSpender(child)}</small></div><strong>{inr(child.amount||0)}</strong>{recordActions("budget",child)}</div>)}</div>}<button className="add-sub-budget" onClick={()=>setSubBudgetParent(root)}>＋ Add spend detail</button></div>})}{matchingBudgetRoots.length===0&&<div className="empty-state">{query?"No matching budget items or spend details.":"No budget items saved yet. Add one to start the shared record."}</div>}</section>:<section className="panel secondary-panel"><div className="empty-state"><div className="setup-icon">🔒</div><h2>Admin budget</h2><p>This account isn’t in the admin list. Ask a wedding admin to add your email to ADMIN_EMAILS.</p></div></section>)}
      {tab==="Schedule"&&<section className="panel secondary-panel"><div className="panel-heading"><div><div className="panel-title">Wedding schedule</div><p>Imported from the family invitation. Events also appear on the guest page.</p></div>{isAdmin&&<button className="button-primary" onClick={()=>setQuickForm("event")}>+ Add event</button>}</div><div className="wedding-timeline">{events.filter(e=>e.startsAt).sort((a,b)=>new Date(a.startsAt!).getTime()-new Date(b.startsAt!).getTime()).map(e=><article className="wedding-event-row" key={e.id}><div className="wedding-event-date"><b>{new Date(e.startsAt!).toLocaleDateString("en-IN",{day:"numeric"})}</b><span>{new Date(e.startsAt!).toLocaleDateString("en-IN",{month:"short"}).toUpperCase()}</span></div><div className="wedding-event-copy"><small>{e.event||"WEDDING EVENT"}</small><b>{e.title}</b><span>{new Date(e.startsAt!).toLocaleTimeString("en-IN",{hour:"numeric",minute:"2-digit"})}{e.endsAt?` – ${new Date(e.endsAt).toLocaleTimeString("en-IN",{hour:"numeric",minute:"2-digit"})}`:""} · {e.venue||"Venue to be announced"}</span>{e.details&&<p>{e.details}</p>}<a className="calendar-link" target="_blank" rel="noreferrer" href={googleCalendarEventURL(e.title,e.startsAt!,e.endsAt,e.venue||"",e.details||"")}>Add to Calendar</a></div>{recordActions("event",e)}</article>)}</div>{events.length===0&&<div className="empty-state"><h2>No events yet</h2><p>Add a ceremony, venue and time to publish it on the guest schedule.</p></div>}</section>}
      {tab==="Notifications"&&<section className="panel secondary-panel"><div className="panel-heading"><div><div className="panel-title">Family notifications <span className="count-pill">{notifications.length}</span></div><p>Pickup reminders and live updates shared with the workspace.</p></div><div className="notification-actions">{notificationPermission==="default"&&<button className="button-quiet" onClick={()=>void enableBrowserNotifications()}>Enable browser alerts</button>}{notificationPermission==="granted"&&<span className="notification-enabled">Browser alerts on</span>}<button className="button-primary" onClick={()=>setShowNotificationForm(true)}>+ Send update</button></div></div><div className="section-subhead">DUE SOON · NEXT 7 DAYS</div>{dueReminders.map(task=><article className="notification-row reminder-row" key={`reminder-${task.id}`}><span className="notification-icon">◷</span><div><b>{task.title}</b><small>{task.assigneeEmail?`Assigned to ${task.assigneeEmail} · `:""}Due {shortDate(task.dueAt)}</small><p>{task.details||"Open the task to add pickup details."}</p></div><button className="text-link" onClick={()=>{setTab("Tasks");setExpanded(task.id)}}>Open task →</button></article>)}{dueReminders.length===0&&<div className="empty-mini">No upcoming task reminders. Add a due date to a dress or shop pickup task to have it appear here.</div>}<div className="section-subhead notification-feed-heading">UPDATES FOR THE FAMILY</div>{notifications.map(item=><article className="notification-row" key={item.id}><span className="notification-icon">{item.notificationKind==="Choreographer arrived"?"♪":item.notificationKind==="Cloth pickup"?"♧":"✳"}</span><div><small className="notification-kind">{item.notificationKind||"Family update"}</small><b>{item.title}</b><p>{item.details||"No extra details."}</p><small>{item.updatedAt?new Date(item.updatedAt).toLocaleString("en-IN"):"Just now"}{item.createdBy?` · ${item.createdBy}`:""}</small></div>{recordActions("notifications",item)}</article>)}{notifications.length===0&&<div className="empty-mini">No family updates yet. Send one when the choreographer arrives or something needs attention.</div>}<p className="notification-footnote">Updates refresh while the app is open. Browser alerts require permission and won’t arrive after the app is closed.</p></section>}
      {tab==="Guests & stays"&&<section className="panel secondary-panel"><div className="panel-heading"><div><div className="panel-title">Guests & stays</div><p>Keep guest groups, hotel assignments and essentials together.</p></div>{isAdmin&&<button className="button-primary" onClick={()=>setQuickForm("guests")}>+ Add guest group</button>}</div><div className="section-subhead">GUEST GROUPS</div>{guestGroups.map(g=><div className="expense-row" key={g.id}><b>{g.title}</b><span>{g.owner||"Family contact"}</span><span>{g.details||"Details pending"}</span><strong>{g.venue||""}</strong>{recordActions("guests",g)}</div>)}{guestGroups.length===0&&<div className="empty-mini">No guest groups saved yet.</div>}<div className="stay-heading"><div><div className="section-subhead">HOTEL & ROOM ASSIGNMENTS</div><p>Assign each guest group to its hotel and record room numbers and essentials.</p></div>{isAdmin&&<button className="button-quiet" onClick={()=>setQuickForm("stays")}>+ Assign stay</button>}</div>{stays.map(x=><article className="stay-record" key={x.id}><div className="stay-main"><b>{x.title}</b><small>{x.venue||"Hotel to confirm"} · {x.owner||"Contact pending"}</small><p>{x.details||"No room notes yet."}</p></div><span className={x.checkedIn?"checkin-badge checked":"checkin-badge"}>{x.checkedIn?`Checked in${x.checkedInBy?` · ${x.checkedInBy}`:""}`:"Not checked in"}</span>{isAdmin&&<button className={x.checkedIn?"button-quiet":"button-primary"} onClick={()=>void toggleStayCheckIn(x)}>{x.checkedIn?"Undo check-in":"Check in guest"}</button>}{recordActions("stays",x)}</article>)}{stays.length===0&&<div className="empty-mini">No room assignments saved yet. Add soap and drinking water as stay essentials too.</div>}</section>}
      {tab==="Transport"&&<section className="panel secondary-panel"><div className="panel-heading"><div><div className="panel-title">Drivers & pickups</div><p>Driver availability and optional phone location sharing</p></div>{isAdmin&&<button className="button-primary" onClick={()=>setQuickForm("transport")}>+ Add driver / car</button>}</div><div className="location-note">Location updates only while a driver has sharing turned on and this page remains open.</div><div className="panel-heading"><div><div className="panel-title">Guest pickup roster</div><p>Arrival time, station or airport, assigned car and pickup status</p></div>{isAdmin&&<button className="button-quiet" onClick={()=>setShowPickupForm(true)}>+ Add pickup</button>}</div>{pickups.map(p=><article className="notification-row" key={p.id}><div><b>{p.guestName||p.title}</b><small>{p.arrivalType||"Arrival"} {p.arrivalNumber||"number pending"} · {p.arrivalAt?new Date(p.arrivalAt).toLocaleString("en-IN"):"time pending"}</small><p>{p.pickupLocation||"Pickup location pending"} · {p.assignedCar||"Car unassigned"} · {p.owner||"Driver unassigned"}</p><small>Status: {p.status||"Planned"}</small></div>{isAdmin&&recordActions("pickups",p)}</article>)}{pickups.length===0&&<div className="empty-mini">No guest pickups assigned yet.</div>}{transport.map(t=><div className="driver-board-row" key={t.id}><div className="driver-avatar">{(t.owner||t.title)[0]}</div><div className="driver-board-copy"><b>{t.owner||t.title}</b><small>{t.title} ? {t.details||"Vehicle details not added"}</small>{t.latitude&&t.longitude&&<a target="_blank" rel="noreferrer" href={"https://maps.google.com/?q="+t.latitude+","+t.longitude}>Open latest location</a>}</div><select value={t.status||"Free"} onChange={e=>void changeDriverStatus(t,e.target.value)}><option>Free</option><option>Going to pickup</option><option>Carrying guests</option><option>Returning</option></select>{sharingId===t.id?<button className="button-quiet" onClick={stopLocationSharing}>Stop sharing</button>:<button className="button-quiet" onClick={()=>startLocationSharing(t)}>Share location</button>}{recordActions("transport",t)}</div>)}{transport.length===0&&<div className="empty-state"><h2>Set up the driver board</h2><p>Add each driver and Ertiga. Drivers can choose their status and share the phone's current location while the page stays open.</p></div>}</section>}
      {tab==="Admin access"&&isAdmin&&<section className="panel secondary-panel"><div className="panel-heading workspace-settings-row"><div><div className="panel-title">Wedding details</div><p>{wedding?.name} ? ?{wedding?.heading}? ? Main admin: {wedding?.mainAdminEmail||"Not assigned"}</p></div>{isMainAdmin&&<button className="button-quiet" onClick={()=>setShowWorkspaceSettings(true)}>Edit wedding details</button>}</div><div className="panel-heading"><div><div className="panel-title">Family access <span className="count-pill">{familyMembers.length}</span></div><p>Add the family Gmail addresses that can sign in and use the shared wedding workspace.</p></div><button className="button-primary" onClick={()=>{setAccessRole("family");setShowAdminForm(true)}}>+ Add family Gmail</button></div><div className="admin-list">{familyMembers.map(member=><div className="admin-row" key={member.email}><div className="admin-avatar">{member.email.slice(0,1).toUpperCase()}</div><div className="admin-copy"><b>{member.email}</b><small>{member.createdBy==="bootstrap"?"Added from initial setup":("Added by "+member.createdBy)} | {new Date(member.createdAt).toLocaleDateString("en-IN")}</small></div><span className="admin-badge">{member.role==="driver"?"DRIVER":"FAMILY"}</span><button className="remove-admin" onClick={()=>void revokeFamilyAccess(member)}>Remove access</button></div>)}</div>{familyMembers.length===0&&<div className="empty-mini">No family Gmail addresses added yet.</div>}<div className="admin-section-heading"><div><div className="panel-title">Admins <span className="count-pill">{adminUsers.length}</span></div><p>Main admin: {wedding?.mainAdminEmail||"Not assigned"}. Admins can view the budget and manage family access.</p></div><button className="button-quiet" onClick={()=>{setAccessRole("admin");setShowAdminForm(true)}}>+ Grant admin access</button></div><div className="admin-list">{adminUsers.map(user=><div className="admin-row" key={user.email}><div className="admin-avatar">{user.email.slice(0,1).toUpperCase()}</div><div className="admin-copy"><b>{user.email}</b><small>{user.createdBy==="bootstrap"?"Initial admin":("Added by "+user.createdBy)} | {new Date(user.createdAt).toLocaleDateString("en-IN")}</small></div><span className="admin-badge">{isWeddingMainAdmin(user.email,wedding?.mainAdminEmail)?"MAIN ADMIN":"ADMIN"}</span>{isMainAdmin&&!isWeddingMainAdmin(user.email,wedding?.mainAdminEmail)&&<button className="text-link" onClick={()=>void transferMainAdmin(user)}>Make main admin</button>}<button className="remove-admin" disabled={adminUsers.length<=1||isWeddingMainAdmin(user.email,wedding?.mainAdminEmail)} onClick={()=>void revokeAdmin(user)}>Remove admin</button></div>)}</div>{adminUsers.length<=1&&<p className="admin-footnote">At least one admin must remain on the wedding workspace.</p>}</section>}
      </div>
    </main>
    {showWorkspaceSettings&&wedding&&<div className="modal-scrim" onClick={()=>setShowWorkspaceSettings(false)}><form className="modal" onSubmit={saveWeddingSettings} onClick={e=>e.stopPropagation()}><button type="button" className="modal-close" onClick={()=>setShowWorkspaceSettings(false)}>?</button><div className="eyebrow">WEDDING IDENTITY</div><h2>Edit wedding details</h2><p>These names appear in this workspace and on its guest page. The route stays the same.</p><label>Wedding name<input name="name" autoFocus required defaultValue={wedding.name}/></label><label>Page heading<input name="heading" required defaultValue={wedding.heading}/></label><div className="modal-actions"><button type="button" className="button-quiet" onClick={()=>setShowWorkspaceSettings(false)}>Cancel</button><button className="button-primary" type="submit">Save details</button></div></form></div>}{showAdminForm&&<div className="modal-scrim" onClick={()=>setShowAdminForm(false)}><form className="modal" onSubmit={grantAccess} onClick={e=>e.stopPropagation()}><button type="button" className="modal-close" onClick={()=>setShowAdminForm(false)}>x</button><div className="eyebrow">{accessRole==="admin"?"ADMIN ACCESS":"FAMILY ACCESS"}</div><h2>{accessRole==="admin"?"Give someone admin access":"Add a family Gmail"}</h2><p>{accessRole==="admin"?"They can use the wedding workspace, view the budget and manage access lists.":"They can sign in and use the shared wedding workspace. Budget details stay private to admins."}</p><label>Google account email<input name="email" type="email" autoFocus required placeholder="name@gmail.com"/></label>{accessRole==="family"&&<label>Access type<select name="role"><option value="family">Family workspace</option><option value="driver">Driver (transport and pickups only)</option></select></label>}<div className="modal-actions"><button type="button" className="button-quiet" onClick={()=>setShowAdminForm(false)}>Cancel</button><button className="button-primary" type="submit">{accessRole==="admin"?"Grant admin access":"Add family access"}</button></div></form></div>}
    {quickForm&&<div className="modal-scrim" onClick={()=>setQuickForm(null)}><form className="modal" onSubmit={createPlanningRecord} onClick={e=>e.stopPropagation()}><button type="button" className="modal-close" onClick={()=>setQuickForm(null)}>?</button><div className="eyebrow">SHARED WITH THE FAMILY</div><h2>{quickForm==="event"?"Add a wedding event":quickForm==="guests"?"Add a guest group":quickForm==="stays"?"Assign rooms or essentials":"Add a driver and car"}</h2><p>{quickForm==="event"?"Guests can see the event time and venue on the public schedule.":quickForm==="transport"?"Add one driver and vehicle. They can sign in and choose to share location.":"Keep the assignment and useful details together."}</p><label>{quickForm==="event"?"Event name":quickForm==="transport"?"Vehicle / driver label":"Guest or assignment name"}<input name="title" autoFocus required placeholder={quickForm==="event"?"Sangeet ceremony":quickForm==="transport"?"Driver 1 ? Ertiga":"Family group, 4 guests"}/></label>{quickForm==="event"&&<><label>Celebration type<input name="event" placeholder="Haldi, Sangeet, Baraat, Reception"/></label><div className="form-grid"><label>Starts<input name="startsAt" type="datetime-local" required/></label><label>Ends<input name="endsAt" type="datetime-local"/></label></div></>}<div className="form-grid"><label>{quickForm==="event"?"Event owner":"Contact / driver"}<input name="owner" placeholder="Name"/></label>{quickForm==="transport"?<label>Availability<select name="status"><option>Free</option><option>Going to pickup</option><option>Carrying guests</option><option>Returning</option></select></label>:<label>{quickForm==="event"?"":"Hotel / venue"}<input name="venue" placeholder={quickForm==="event"?"Main lawn":"Hotel name"}/></label>}</div>{quickForm==="stays"&&<><div className="form-grid"><label>Train / flight type<input name="arrivalType" placeholder="Train or flight"/></label><label>Train / flight number<input name="arrivalNumber"/></label></div><label>Arrival time<input name="arrivalAt" type="datetime-local" required/></label><div className="form-grid"><label>Pickup point<input name="pickupLocation" placeholder="Station / airport"/></label><label>Assigned car<input name="assignedCar" placeholder="Ertiga 1"/></label></div></>}{quickForm==="stays"&&<label>Room number<input name="area" placeholder="Room number"/></label>}{quickForm==="stays"&&<label>Guest-visible stay instructions<textarea name="guestInstructions" rows={2} placeholder="Check-in, water, soap or directions for this guest"/></label>}<label>Private notes<input name="details" placeholder={quickForm==="stays"?"Room numbers, water, soap?":"Add helpful details"}/></label><div className="modal-actions"><button type="button" className="button-quiet" onClick={()=>setQuickForm(null)}>Cancel</button><button className="button-primary" type="submit">Save details ?</button></div></form></div>}
    {showTaskForm&&<div className="modal-scrim" onClick={()=>setShowTaskForm(false)}><form className="modal" onSubmit={createTask} onClick={e=>e.stopPropagation()}><button type="button" className="modal-close" onClick={()=>setShowTaskForm(false)}>×</button><div className="eyebrow">A SMALL STEP, TAKEN TOGETHER</div><h2>Add a family task</h2><p>Assign it to someone who has signed into this family workspace. They and the rest of the family can update the notes.</p><label>Task name<input name="title" autoFocus required placeholder="e.g. Pick up the wedding clothes"/></label><div className="form-grid"><label>Area<input name="area" placeholder="Sangeet, shopping…"/></label><label>Owner / assigned by<input name="owner" placeholder={email}/></label></div><label>Assign to existing member<select name="assigneeEmail" defaultValue={email}><option value="">Unassigned</option>{workspaceUsers.map(user=><option value={user.email} key={user.email}>{user.email}</option>)}</select></label><label>Due date<input name="dueAt" type="date"/></label><label>Full description and notes<textarea name="details" rows={4} placeholder="Add the full description, shop address, checklist or updates"/></label><div className="modal-actions"><button type="button" className="button-quiet" onClick={()=>setShowTaskForm(false)}>Cancel</button><button className="button-primary" type="submit">Save task →</button></div></form></div>}
    {showNotificationForm&&<div className="modal-scrim" onClick={()=>setShowNotificationForm(false)}><form className="modal" onSubmit={createNotification} onClick={e=>e.stopPropagation()}><button type="button" className="modal-close" onClick={()=>setShowNotificationForm(false)}>×</button><div className="eyebrow">SEND A FAMILY UPDATE</div><h2>Notify the family</h2><p>This appears in everyone’s notification feed and triggers a browser alert for members who enabled alerts and have the app open.</p><label>Update type<select name="notificationKind"><option>Family update</option><option>Cloth pickup</option><option>Choreographer arrived</option></select></label><label>Short message<input name="title" required autoFocus placeholder="e.g. Choreographer has arrived at the venue"/></label><label>Details<textarea name="details" rows={3} placeholder="Where to meet, what to collect or who needs to know"/></label><div className="modal-actions"><button type="button" className="button-quiet" onClick={()=>setShowNotificationForm(false)}>Cancel</button><button className="button-primary" type="submit">Send update</button></div></form></div>}
    {editingRecord&&<div className="modal-scrim" onClick={()=>setEditingRecord(null)}><form className="modal record-edit-modal" key={`${editingRecord.kind}-${editingRecord.record.id}`} onSubmit={saveRecord} onClick={e=>e.stopPropagation()}><button type="button" className="modal-close" onClick={()=>setEditingRecord(null)}>×</button><div className="eyebrow">EDIT SHARED RECORD</div><h2>{editingRecord.record.title}</h2><label>Title<input name="title" defaultValue={editingRecord.record.title} required/></label>{editingRecord.kind==="task"&&<><div className="form-grid"><label>Area<input name="area" defaultValue={editingRecord.record.area||""}/></label><label>Assigned by<input name="owner" defaultValue={editingRecord.record.owner||editingRecord.record.createdBy||""}/></label></div><label>Assign to<select name="assigneeEmail" defaultValue={editingRecord.record.assigneeEmail||""}><option value="">Unassigned</option>{workspaceUsers.map(user=><option value={user.email} key={user.email}>{user.email}</option>)}</select></label><label>Due date<input name="dueAt" type="date" defaultValue={dateTimeInput(editingRecord.record.dueAt).slice(0,10)}/></label><label>Status<select name="status" defaultValue={editingRecord.record.status||"To do"}><option>To do</option><option>In progress</option><option>Done</option></select></label></>}{editingRecord.kind==="event"&&<><label>Event category<input name="event" defaultValue={editingRecord.record.event||""}/></label><div className="form-grid"><label>Starts<input name="startsAt" type="datetime-local" defaultValue={dateTimeInput(editingRecord.record.startsAt)}/></label><label>Ends<input name="endsAt" type="datetime-local" defaultValue={dateTimeInput(editingRecord.record.endsAt)}/></label></div><label>Venue<input name="venue" defaultValue={editingRecord.record.venue||""}/></label></>}{editingRecord.kind==="budget"&&<><div className="form-grid"><label>Event<input name="event" defaultValue={editingRecord.record.event||""}/></label><label>Owner<input name="owner" defaultValue={editingRecord.record.owner||""}/></label></div><label>Amount in ₹<input name="amount" type="number" min="0" defaultValue={editingRecord.record.amount||0}/></label><div className="form-grid"><label>Vendor<input name="vendor" defaultValue={editingRecord.record.vendor||""}/></label><label>Paid so far in ₹<input name="paidAmount" type="number" min="0" defaultValue={editingRecord.record.paidAmount||0}/></label></div><label>Payment status<select name="paymentStatus" defaultValue={editingRecord.record.paymentStatus||"Unpaid"}><option>Unpaid</option><option>Partially paid</option><option>Paid</option></select></label><label>Bill photo or PDF (max 3 MB)<input name="billFile" type="file" accept="image/*,application/pdf"/></label><label>Bill link<input name="billUrl" type="url" defaultValue={editingRecord.record.billUrl||""}/></label>{(editingRecord.record.billData||editingRecord.record.billUrl)&&<a href={editingRecord.record.billData||editingRecord.record.billUrl} target="_blank" rel="noreferrer">View saved bill {editingRecord.record.billFileName?`(${editingRecord.record.billFileName})`:""}</a>}</>}{(editingRecord.kind==="guests"||editingRecord.kind==="stays")&&<><div className="form-grid"><label>Contact / assigned to<input name="owner" defaultValue={editingRecord.record.owner||""}/></label><label>Hotel / venue<input name="venue" defaultValue={editingRecord.record.venue||""}/></label></div>{editingRecord.kind==="stays"&&<><label>Room number<input name="area" defaultValue={editingRecord.record.area||""}/></label><label>Guest-visible instructions<textarea name="guestInstructions" rows={2} defaultValue={editingRecord.record.guestInstructions||""}/></label><div className="form-grid"><label>Train / flight type<input name="arrivalType" defaultValue={editingRecord.record.arrivalType||""}/></label><label>Train / flight number<input name="arrivalNumber" defaultValue={editingRecord.record.arrivalNumber||""}/></label></div><label>Arrival time<input name="arrivalAt" type="datetime-local" defaultValue={dateTimeInput(editingRecord.record.arrivalAt)}/></label><div className="form-grid"><label>Pickup location<input name="pickupLocation" defaultValue={editingRecord.record.pickupLocation||""}/></label><label>Assigned car<input name="assignedCar" defaultValue={editingRecord.record.assignedCar||""}/></label></div></>}</>}{editingRecord.kind==="pickups"&&<><div className="form-grid"><label>Train / flight number<input name="arrivalNumber" defaultValue={editingRecord.record.arrivalNumber||""}/></label><label>Arrival time<input name="arrivalAt" type="datetime-local" defaultValue={dateTimeInput(editingRecord.record.arrivalAt)}/></label></div><div className="form-grid"><label>Pickup location<input name="pickupLocation" defaultValue={editingRecord.record.pickupLocation||""}/></label><label>Assigned car<input name="assignedCar" defaultValue={editingRecord.record.assignedCar||""}/></label></div><div className="form-grid"><label>Driver<input name="owner" defaultValue={editingRecord.record.owner||""}/></label><label>Status<select name="status" defaultValue={editingRecord.record.status||"Planned"}><option>Planned</option><option>Driver assigned</option><option>On the way</option><option>Picked up</option><option>Completed</option></select></label></div></>}{editingRecord.kind==="transport"&&<><div className="form-grid"><label>Driver / contact<input name="owner" defaultValue={editingRecord.record.owner||""}/></label><label>Availability<select name="status" defaultValue={editingRecord.record.status||"Free"}><option>Free</option><option>Going to pickup</option><option>Carrying guests</option><option>Returning</option></select></label></div></>}{editingRecord.kind==="notifications"&&<label>Update type<select name="notificationKind" defaultValue={editingRecord.record.notificationKind||"Family update"}><option>Family update</option><option>Cloth pickup</option><option>Choreographer arrived</option></select></label>}<label>Description and notes<textarea name="details" rows={4} defaultValue={editingRecord.record.details||""}/></label><div className="modal-actions"><button type="button" className="button-quiet" onClick={()=>setEditingRecord(null)}>Cancel</button><button className="button-primary" type="submit">Save changes</button></div></form></div>}
    {showPickupForm&&<div className="modal-scrim" onClick={()=>setShowPickupForm(false)}><form className="modal" onSubmit={createPickup} onClick={e=>e.stopPropagation()}><button type="button" className="modal-close" onClick={()=>setShowPickupForm(false)}>×</button><div className="eyebrow">GUEST ARRIVAL</div><h2>Add pickup assignment</h2><label>Guest name<input name="guestName" required/></label><div className="form-grid"><label>Phone<input name="guestPhone" type="tel"/></label><label>Arrival type<select name="arrivalType"><option>Train</option><option>Flight</option></select></label></div><div className="form-grid"><label>Train / flight number<input name="arrivalNumber" required/></label><label>Arrival time<input name="arrivalAt" type="datetime-local"/></label></div><div className="form-grid"><label>Station / airport<input name="pickupLocation" required/></label><label>Assigned car<input name="assignedCar" placeholder="Ertiga 1"/></label></div><label>Driver<input name="owner" placeholder="Driver name"/></label><label>Notes<textarea name="details" rows={3}/></label><div className="modal-actions"><button type="button" className="button-quiet" onClick={()=>setShowPickupForm(false)}>Cancel</button><button className="button-primary">Save pickup</button></div></form></div>}{showBudgetForm&&<div className="modal-scrim" onClick={()=>setShowBudgetForm(false)}><form className="modal" onSubmit={createBudgetItem} onClick={e=>e.stopPropagation()}><button type="button" className="modal-close" onClick={()=>setShowBudgetForm(false)}>×</button><div className="eyebrow">ADMIN ONLY</div><h2>Add a budget item</h2><p>Only admins can view these records. Attach a bill and enter its vendor and payment details below.</p><label>Item<input name="title" autoFocus required placeholder="e.g. Bubble machine"/></label><div className="form-grid"><label>Event<input name="event" placeholder="Reception Varmala"/></label><label>Owner<input name="owner" placeholder="Akshay"/></label></div><label>Amount in ₹<input name="amount" type="number" min="0" required placeholder="5000"/></label><div className="form-grid"><label>Vendor<input name="vendor" placeholder="Vendor name"/></label><label>Paid so far in ₹<input name="paidAmount" type="number" min="0" defaultValue="0"/></label></div><label>Payment status<select name="paymentStatus"><option>Unpaid</option><option>Partially paid</option><option>Paid</option></select></label><label>Bill photo or PDF (max 3 MB)<input name="billFile" type="file" accept="image/*,application/pdf"/></label><label>Bill link (optional)<input name="billUrl" type="url" placeholder="https://…"/></label><div className="modal-actions"><button type="button" className="button-quiet" onClick={()=>setShowBudgetForm(false)}>Cancel</button><button className="button-primary" type="submit">Save expense →</button></div></form></div>}
    {subBudgetParent&&<div className="modal-scrim" onClick={()=>setSubBudgetParent(null)}><form className="modal" onSubmit={createSubBudgetItem} onClick={e=>e.stopPropagation()}><button type="button" className="modal-close" onClick={()=>setSubBudgetParent(null)}>×</button><div className="eyebrow">SUB-BUDGET DETAIL</div><h2>Add spend under {subBudgetParent.title}</h2><p>This amount becomes part of the parent’s breakdown total.</p><label>Spend item<input name="title" autoFocus required placeholder="e.g. Flowers, carpet, lights"/></label><label>Amount in ₹<input name="amount" type="number" min="0" required placeholder="5000"/></label><label>Vendor / person<input name="owner" placeholder="Vendor or family member"/></label><label>Notes<textarea name="details" rows={3} placeholder="Quantity, invoice details or what this covers"/></label><div className="modal-actions"><button type="button" className="button-quiet" onClick={()=>setSubBudgetParent(null)}>Cancel</button><button className="button-primary" type="submit">Save spend detail</button></div></form></div>}
  </div>;
}
