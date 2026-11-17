package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/mail"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"google.golang.org/api/idtoken"
)

type App struct {
	db             *mongo.Database
	googleClientID string
	allowedOrigin  string
	defaultWedding string
	adminLock      sync.Mutex
}

type Record struct {
	ID               primitive.ObjectID  `bson:"_id,omitempty" json:"id"`
	WeddingID        string              `bson:"weddingId,omitempty" json:"weddingId,omitempty"`
	Type             string              `bson:"type" json:"type"`
	Title            string              `bson:"title" json:"title"`
	Area             string              `bson:"area,omitempty" json:"area,omitempty"`
	Owner            string              `bson:"owner,omitempty" json:"owner,omitempty"`
	AssigneeEmail    string              `bson:"assigneeEmail,omitempty" json:"assigneeEmail,omitempty"`
	DueAt            *time.Time          `bson:"dueAt,omitempty" json:"dueAt,omitempty"`
	EndsAt           *time.Time          `bson:"endsAt,omitempty" json:"endsAt,omitempty"`
	Status           string              `bson:"status,omitempty" json:"status,omitempty"`
	CheckedIn        bool                `bson:"checkedIn,omitempty" json:"checkedIn,omitempty"`
	CheckedInAt      *time.Time          `bson:"checkedInAt,omitempty" json:"checkedInAt,omitempty"`
	CheckedInBy      string              `bson:"checkedInBy,omitempty" json:"checkedInBy,omitempty"`
	UpdatedBy        string              `bson:"updatedBy,omitempty" json:"updatedBy,omitempty"`
	Details          string              `bson:"details,omitempty" json:"details,omitempty"`
	Event            string              `bson:"event,omitempty" json:"event,omitempty"`
	NotificationKind string              `bson:"notificationKind,omitempty" json:"notificationKind,omitempty"`
	ParentID         *primitive.ObjectID `bson:"parentId,omitempty" json:"parentId,omitempty"`
	Amount           *int64              `bson:"amount,omitempty" json:"amount,omitempty"`
	Venue            string              `bson:"venue,omitempty" json:"venue,omitempty"`
	StartsAt         *time.Time          `bson:"startsAt,omitempty" json:"startsAt,omitempty"`
	Latitude         *float64            `bson:"latitude,omitempty" json:"latitude,omitempty"`
	Longitude        *float64            `bson:"longitude,omitempty" json:"longitude,omitempty"`
	CreatedBy        string              `bson:"createdBy,omitempty" json:"createdBy,omitempty"`
	CreatedByName    string              `bson:"createdByName,omitempty" json:"createdByName,omitempty"`
	UpdatedAt        time.Time           `bson:"updatedAt" json:"updatedAt"`
}

type Admin struct {
	WeddingID string    `bson:"weddingId" json:"weddingId"`
	Email     string    `bson:"email" json:"email"`
	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
	CreatedBy string    `bson:"createdBy" json:"createdBy"`
}

type FamilyMember struct {
	WeddingID string    `bson:"weddingId" json:"weddingId"`
	Email     string    `bson:"email" json:"email"`
	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
	CreatedBy string    `bson:"createdBy" json:"createdBy"`
	Active    bool      `bson:"active" json:"active"`
}

type Member struct {
	WeddingID  string    `bson:"weddingId" json:"weddingId"`
	Email      string    `bson:"email" json:"email"`
	CreatedAt  time.Time `bson:"createdAt" json:"createdAt"`
	LastSeenAt time.Time `bson:"lastSeenAt" json:"lastSeenAt"`
}

type Wedding struct {
	Slug           string    `bson:"slug" json:"slug"`
	Name           string    `bson:"name" json:"name"`
	Heading        string    `bson:"heading" json:"heading"`
	MainAdminEmail string    `bson:"mainAdminEmail" json:"mainAdminEmail"`
	CreatedAt      time.Time `bson:"createdAt" json:"createdAt"`
	CreatedBy      string    `bson:"createdBy" json:"createdBy"`
}

type identity struct {
	Email         string `json:"email"`
	Name          string `json:"name"`
	EmailVerified string `json:"email_verified"`
	Audience      string `json:"aud"`
}

func main() {
	loadEnvFile(".env")
	uri := os.Getenv("MONGODB_URI")
	if uri == "" {
		log.Fatal("MONGODB_URI is required")
	}
	if os.Getenv("GOOGLE_CLIENT_ID") == "" {
		log.Fatal("GOOGLE_CLIENT_ID is required")
	}
	database := os.Getenv("MONGODB_DATABASE")
	if database == "" {
		database = "shaadi_hq"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		log.Fatalf("connect to MongoDB: %v", err)
	}
	if err = client.Ping(ctx, nil); err != nil {
		log.Fatalf("ping MongoDB: %v", err)
	}
	log.Printf("MongoDB connection established (database=%s)", database)
	admins := map[string]bool{}
	for _, email := range strings.Split(strings.ToLower(os.Getenv("ADMIN_EMAILS")), ",") {
		if email = strings.TrimSpace(email); email != "" {
			admins[email] = true
		}
	}
	db := client.Database(database)
	if err = bootstrapWeddingData(ctx, db, admins); err != nil {
		log.Fatalf("initialize wedding workspaces: %v", err)
	}
	if err = bootstrapAdmins(ctx, db, admins, "sharma-wedding"); err != nil {
		log.Fatalf("initialize admin list: %v", err)
	}
	if err = setDefaultMainAdmin(ctx, db, admins); err != nil {
		log.Fatalf("initialize main admin: %v", err)
	}
	family := map[string]bool{}
	for _, email := range strings.Split(strings.ToLower(os.Getenv("FAMILY_EMAILS")), ",") {
		if email = strings.TrimSpace(email); email != "" {
			family[email] = true
		}
	}
	if err = bootstrapFamilyMembers(ctx, db, family, "sharma-wedding"); err != nil {
		log.Fatalf("initialize family access list: %v", err)
	}
	if err = seedWeddingSchedule(ctx, db); err != nil {
		log.Fatalf("initialize wedding schedule: %v", err)
	}
	app := &App{db: db, googleClientID: os.Getenv("GOOGLE_CLIENT_ID"), allowedOrigin: envOr("CORS_ORIGIN", "http://localhost:3000"), defaultWedding: "sharma-wedding"}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", app.health)
	mux.Handle("GET /api/weddings", app.requireIdentity(http.HandlerFunc(app.listWeddings)))
	mux.Handle("POST /api/weddings", app.requireIdentity(http.HandlerFunc(app.createWedding)))
	mux.Handle("PATCH /api/weddings/{slug}", app.requireAdmin(http.HandlerFunc(app.updateWeddingSettings)))
	mux.Handle("PATCH /api/weddings/{slug}/main-admin", app.requireAdmin(http.HandlerFunc(app.setMainAdmin)))
	mux.HandleFunc("GET /api/public/events", app.listPublicEvents)
	mux.Handle("GET /api/me", app.requireUser(http.HandlerFunc(app.me)))
	mux.Handle("GET /api/users", app.requireUser(http.HandlerFunc(app.listUsers)))
	mux.Handle("GET /api/admins", app.requireAdmin(http.HandlerFunc(app.listAdmins)))
	mux.Handle("POST /api/admins", app.requireAdmin(http.HandlerFunc(app.addAdmin)))
	mux.Handle("DELETE /api/admins/{email}", app.requireAdmin(http.HandlerFunc(app.removeAdmin)))
	mux.Handle("GET /api/family-members", app.requireAdmin(http.HandlerFunc(app.listFamilyMembers)))
	mux.Handle("POST /api/family-members", app.requireAdmin(http.HandlerFunc(app.addFamilyMember)))
	mux.Handle("DELETE /api/family-members/{email}", app.requireAdmin(http.HandlerFunc(app.removeFamilyMember)))
	mux.Handle("GET /api/tasks", app.requireUser(http.HandlerFunc(app.listTasks)))
	mux.Handle("POST /api/tasks", app.requireUser(http.HandlerFunc(app.createTask)))
	mux.Handle("PATCH /api/tasks/{id}", app.requireUser(http.HandlerFunc(app.updateTask)))
	mux.Handle("DELETE /api/tasks/{id}", app.requireUser(http.HandlerFunc(app.deleteTask)))
	mux.Handle("PATCH /api/transport/{id}", app.requireUser(http.HandlerFunc(app.updateTransport)))
	mux.Handle("GET /api/budget", app.requireAdmin(http.HandlerFunc(app.listBudget)))
	mux.Handle("POST /api/budget", app.requireAdmin(http.HandlerFunc(app.createBudgetItem)))
	mux.Handle("PATCH /api/budget/{id}", app.requireAdmin(http.HandlerFunc(app.updateBudgetItem)))
	mux.Handle("DELETE /api/budget/{id}", app.requireAdmin(http.HandlerFunc(app.deleteBudgetItem)))
	mux.Handle("PATCH /api/{collection}/{id}", app.requireUser(http.HandlerFunc(app.updateCollectionRecord)))
	mux.Handle("DELETE /api/{collection}/{id}", app.requireUser(http.HandlerFunc(app.deleteCollectionRecord)))
	mux.Handle("GET /api/{collection}", app.requireUser(http.HandlerFunc(app.listCollection)))
	mux.Handle("POST /api/{collection}", app.requireUser(http.HandlerFunc(app.createCollectionRecord)))
	server := &http.Server{Addr: ":" + envOr("PORT", "8080"), Handler: app.cors(app.logAPIRequests(mux)), ReadHeaderTimeout: 5 * time.Second}
	log.Printf("Shaadi HQ API listening on %s", server.Addr)
	log.Fatal(server.ListenAndServe())
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func loadEnvFile(path string) {
	workingDirectory, _ := os.Getwd()
	executablePath, _ := os.Executable()
	var file *os.File
	for _, candidate := range envFileSearchPaths(path, workingDirectory, executablePath) {
		opened, err := os.Open(candidate)
		if err == nil {
			file = opened
			break
		}
	}
	if file == nil {
		return
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), "\"'")
		if key != "" && os.Getenv(key) == "" {
			_ = os.Setenv(key, value)
		}
	}
}

func envFileSearchPaths(filename, workingDirectory, executablePath string) []string {
	if filepath.IsAbs(filename) {
		return []string{filepath.Clean(filename)}
	}
	paths := make([]string, 0, 4)
	seen := make(map[string]bool)
	add := func(path string) {
		if path == "" {
			return
		}
		path = filepath.Clean(path)
		if !seen[path] {
			paths = append(paths, path)
			seen[path] = true
		}
	}
	if workingDirectory != "" {
		add(filepath.Join(workingDirectory, filename))
	} else {
		add(filename)
	}
	if executablePath != "" {
		executableDirectory := filepath.Dir(executablePath)
		add(filepath.Join(executableDirectory, filename))
		add(filepath.Join(filepath.Dir(executableDirectory), filename))
	}
	return paths
}

func bootstrapWeddingData(ctx context.Context, db *mongo.Database, adminEmails map[string]bool) error {
	slug := "sharma-wedding"
	mainAdmin := firstEmail(adminEmails)
	weddings := db.Collection("weddings")
	if _, err := weddings.Indexes().CreateOne(ctx, mongo.IndexModel{Keys: bson.D{{Key: "slug", Value: 1}}, Options: options.Index().SetUnique(true)}); err != nil {
		return err
	}
	_, err := weddings.UpdateOne(ctx, bson.M{"slug": slug}, bson.M{"$setOnInsert": bson.M{"slug": slug, "name": "Sharma Wedding", "heading": "The Sharma Wedding", "mainAdminEmail": mainAdmin, "createdAt": time.Now().UTC(), "createdBy": "bootstrap"}}, options.Update().SetUpsert(true))
	if err != nil {
		return err
	}
	upadhyayAdmin := mainAdmin
	if adminEmails["priyashsharma24@gmail.com"] {
		upadhyayAdmin = "priyashsharma24@gmail.com"
	}
	upadhyay := Wedding{Slug: "upadhyay-wedding", Name: "Upadhyay Wedding", Heading: "The Upadhyay Wedding", MainAdminEmail: upadhyayAdmin, CreatedAt: time.Now().UTC(), CreatedBy: "bootstrap"}
	if _, err := weddings.UpdateOne(ctx, bson.M{"slug": upadhyay.Slug}, bson.M{"$setOnInsert": upadhyay}, options.Update().SetUpsert(true)); err != nil {
		return err
	}
	for _, name := range []string{"records", "admins", "family_members", "workspace_users"} {
		if _, err := db.Collection(name).UpdateMany(ctx, bson.M{"weddingId": bson.M{"$exists": false}}, bson.M{"$set": bson.M{"weddingId": slug}}); err != nil {
			return err
		}
	}
	for _, name := range []string{"admins", "family_members", "workspace_users"} {
		indexes := db.Collection(name).Indexes()
		if _, err := indexes.DropOne(ctx, "email_1"); err != nil && !strings.Contains(strings.ToLower(err.Error()), "index not found") {
			return err
		}
		if _, err := indexes.CreateOne(ctx, mongo.IndexModel{Keys: bson.D{{Key: "weddingId", Value: 1}, {Key: "email", Value: 1}}, Options: options.Index().SetUnique(true)}); err != nil {
			return err
		}
	}
	if upadhyayAdmin != "" {
		_, err := db.Collection("admins").UpdateOne(ctx, bson.M{"weddingId": upadhyay.Slug, "email": upadhyayAdmin}, bson.M{"$setOnInsert": bson.M{"weddingId": upadhyay.Slug, "email": upadhyayAdmin, "createdAt": upadhyay.CreatedAt, "createdBy": "bootstrap"}}, options.Update().SetUpsert(true))
		if err != nil {
			return err
		}
	}
	return nil
}

func firstEmail(emails map[string]bool) string {
	ordered := make([]string, 0, len(emails))
	for email := range emails {
		ordered = append(ordered, email)
	}
	if len(ordered) == 0 {
		return ""
	}
	// Stable selection matters for the first workspace's initial main admin.
	for i := 0; i < len(ordered); i++ {
		for j := i + 1; j < len(ordered); j++ {
			if ordered[j] < ordered[i] {
				ordered[i], ordered[j] = ordered[j], ordered[i]
			}
		}
	}
	return ordered[0]
}

func setDefaultMainAdmin(ctx context.Context, db *mongo.Database, emails map[string]bool) error {
	if email := firstEmail(emails); email != "" {
		_, err := db.Collection("weddings").UpdateOne(ctx, bson.M{"slug": "sharma-wedding", "mainAdminEmail": ""}, bson.M{"$set": bson.M{"mainAdminEmail": email}})
		return err
	}
	return nil
}

func workspaceFilter(slug string, filter bson.M) bson.M {
	result := bson.M{"weddingId": slug}
	for key, value := range filter {
		result[key] = value
	}
	return result
}
func (a *App) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *App) listWeddings(w http.ResponseWriter, r *http.Request) {
	id := r.Context().Value(userKey{}).(identity)
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	cur, err := a.db.Collection("weddings").Find(ctx, bson.M{}, options.Find().SetSort(bson.D{{Key: "createdAt", Value: 1}}))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not load wedding workspaces")
		return
	}
	defer cur.Close(ctx)
	all := []Wedding{}
	if err = cur.All(ctx, &all); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not read wedding workspaces")
		return
	}
	accessible := make([]Wedding, 0, len(all))
	for _, wedding := range all {
		admin, checkErr := a.isAdmin(ctx, id.Email, wedding.Slug)
		if checkErr != nil {
			writeError(w, http.StatusInternalServerError, "Could not check wedding access")
			return
		}
		member, checkErr := a.isFamilyMember(ctx, id.Email, wedding.Slug)
		if checkErr != nil {
			writeError(w, http.StatusInternalServerError, "Could not check wedding access")
			return
		}
		if admin || member {
			accessible = append(accessible, wedding)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"email": id.Email, "weddings": accessible})
}

func (a *App) createWedding(w http.ResponseWriter, r *http.Request) {
	id := r.Context().Value(userKey{}).(identity)
	var request struct {
		Name           string `json:"name"`
		Heading        string `json:"heading"`
		MainAdminEmail string `json:"mainAdminEmail"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	name := strings.TrimSpace(request.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "Wedding name is required")
		return
	}
	slug := weddingSlug(name)
	if slug == "" {
		writeError(w, http.StatusBadRequest, "Wedding name must include English letters or numbers")
		return
	}
	heading := strings.TrimSpace(request.Heading)
	if heading == "" {
		heading = name
	}
	mainAdmin := strings.ToLower(strings.TrimSpace(request.MainAdminEmail))
	if mainAdmin == "" {
		mainAdmin = strings.ToLower(id.Email)
	}
	parsed, err := mail.ParseAddress(mainAdmin)
	if err != nil || parsed.Address != mainAdmin {
		writeError(w, http.StatusBadRequest, "Enter a valid main admin Gmail address")
		return
	}
	wedding := Wedding{Slug: slug, Name: name, Heading: heading, MainAdminEmail: mainAdmin, CreatedAt: time.Now().UTC(), CreatedBy: strings.ToLower(id.Email)}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	if _, err = a.db.Collection("weddings").InsertOne(ctx, wedding); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			writeError(w, http.StatusConflict, "A wedding with this name and route already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "Could not create wedding workspace")
		return
	}
	admins := []any{Admin{WeddingID: slug, Email: strings.ToLower(id.Email), CreatedAt: wedding.CreatedAt, CreatedBy: strings.ToLower(id.Email)}}
	if !strings.EqualFold(mainAdmin, id.Email) {
		admins = append(admins, Admin{WeddingID: slug, Email: mainAdmin, CreatedAt: wedding.CreatedAt, CreatedBy: strings.ToLower(id.Email)})
	}
	if _, err = a.db.Collection("admins").InsertMany(ctx, admins); err != nil {
		_, _ = a.db.Collection("weddings").DeleteOne(ctx, bson.M{"slug": slug})
		_, _ = a.db.Collection("admins").DeleteMany(ctx, bson.M{"weddingId": slug})
		writeError(w, http.StatusInternalServerError, "Could not set up wedding admins")
		return
	}
	writeJSON(w, http.StatusCreated, wedding)
}

func (a *App) setMainAdmin(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(userKey{}).(identity)
	weddingID := a.requestedWedding(r)
	if r.PathValue("slug") != weddingID {
		writeError(w, http.StatusBadRequest, "Wedding route does not match the active workspace")
		return
	}
	var request struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	email := strings.ToLower(strings.TrimSpace(request.Email))
	parsed, err := mail.ParseAddress(email)
	if err != nil || parsed.Address != email {
		writeError(w, http.StatusBadRequest, "Enter a valid main admin email address")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	var current Wedding
	if err := a.db.Collection("weddings").FindOne(ctx, bson.M{"slug": weddingID}).Decode(&current); err != nil {
		writeError(w, http.StatusNotFound, "Wedding workspace not found")
		return
	}
	if !strings.EqualFold(actor.Email, current.MainAdminEmail) {
		writeError(w, http.StatusForbidden, "Only the current main admin can transfer this role")
		return
	}
	admins := a.db.Collection("admins")
	_, err = admins.UpdateOne(ctx, bson.M{"weddingId": weddingID, "email": email}, bson.M{"$setOnInsert": bson.M{"weddingId": weddingID, "email": email, "createdAt": time.Now().UTC(), "createdBy": strings.ToLower(actor.Email)}}, options.Update().SetUpsert(true))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not grant admin access")
		return
	}
	result, err := a.db.Collection("weddings").UpdateOne(ctx, bson.M{"slug": weddingID}, bson.M{"$set": bson.M{"mainAdminEmail": email}})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not update the main admin")
		return
	}
	if result.MatchedCount == 0 {
		writeError(w, http.StatusNotFound, "Wedding workspace not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"mainAdminEmail": email})
}

func (a *App) updateWeddingSettings(w http.ResponseWriter, r *http.Request) {
	actor := r.Context().Value(userKey{}).(identity)
	weddingID := a.requestedWedding(r)
	if r.PathValue("slug") != weddingID {
		writeError(w, http.StatusBadRequest, "Wedding route does not match the active workspace")
		return
	}
	var request struct {
		Name    string `json:"name"`
		Heading string `json:"heading"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	request.Name = strings.TrimSpace(request.Name)
	request.Heading = strings.TrimSpace(request.Heading)
	if request.Name == "" || request.Heading == "" {
		writeError(w, http.StatusBadRequest, "Wedding name and heading are required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	var current Wedding
	if err := a.db.Collection("weddings").FindOne(ctx, bson.M{"slug": weddingID}).Decode(&current); err != nil {
		writeError(w, http.StatusNotFound, "Wedding workspace not found")
		return
	}
	if !strings.EqualFold(actor.Email, current.MainAdminEmail) {
		writeError(w, http.StatusForbidden, "Only the main admin can change wedding name and heading")
		return
	}
	if _, err := a.db.Collection("weddings").UpdateOne(ctx, bson.M{"slug": weddingID}, bson.M{"$set": bson.M{"name": request.Name, "heading": request.Heading}}); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not update wedding settings")
		return
	}
	current.Name = request.Name
	current.Heading = request.Heading
	writeJSON(w, http.StatusOK, current)
}

func weddingSlug(name string) string {
	var builder strings.Builder
	separator := false
	for _, character := range strings.ToLower(strings.TrimSpace(name)) {
		if character < unicode.MaxASCII && (unicode.IsLetter(character) || unicode.IsDigit(character)) {
			if separator && builder.Len() > 0 {
				builder.WriteByte('-')
			}
			builder.WriteRune(character)
			separator = false
		} else {
			separator = true
		}
	}
	return strings.Trim(builder.String(), "-")
}

func (a *App) me(w http.ResponseWriter, r *http.Request) {
	id := r.Context().Value(userKey{}).(identity)
	weddingID := a.requestedWedding(r)
	now := time.Now().UTC()
	_, err := a.db.Collection("workspace_users").UpdateOne(r.Context(), bson.M{"weddingId": weddingID, "email": strings.ToLower(id.Email)}, bson.M{
		"$set":         bson.M{"weddingId": weddingID, "email": strings.ToLower(id.Email), "lastSeenAt": now},
		"$setOnInsert": bson.M{"createdAt": now},
	}, options.Update().SetUpsert(true))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not register this family account")
		return
	}
	isAdmin, err := a.isAdmin(r.Context(), id.Email, weddingID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not check account access")
		return
	}
	var wedding Wedding
	if err := a.db.Collection("weddings").FindOne(r.Context(), bson.M{"slug": weddingID}).Decode(&wedding); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not load wedding settings")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"email": id.Email, "isAdmin": isAdmin, "isMainAdmin": strings.EqualFold(wedding.MainAdminEmail, id.Email), "wedding": wedding})
}

func (a *App) listUsers(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	cur, err := a.db.Collection("workspace_users").Find(ctx, bson.M{"weddingId": a.requestedWedding(r)}, options.Find().SetSort(bson.D{{Key: "email", Value: 1}}))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not load family members")
		return
	}
	defer cur.Close(ctx)
	users := []Member{}
	if err = cur.All(ctx, &users); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not read family members")
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func seedWeddingSchedule(ctx context.Context, db *mongo.Database) error {
	collection := db.Collection("records")
	ist := time.FixedZone("IST", 5*60*60+30*60)
	venue := "Hotel Imperial Sabre, VIP Road, Khanugaon Chauraha, Lalghati, Bhopal"
	now := time.Now().UTC()
	event := func(title, kind, description string, day, hour, minute, duration int) Record {
		start := time.Date(2026, time.November, day, hour, minute, 0, 0, ist)
		end := start.Add(time.Duration(duration) * time.Hour)
		return Record{ID: primitive.NewObjectID(), WeddingID: "sharma-wedding", Type: "event", Title: title, Event: kind, StartsAt: &start, EndsAt: &end, Venue: venue, Details: description, UpdatedAt: now}
	}
	events := []Record{
		event("Rangilo Maro Dholna", "Haldi", "A splash of yellow and a lot of laughter. Festive Indian wear; suggested colors: yellow, orange, gold and cream.", 25, 12, 30, 2),
		event("Nach Baliye", "Sangeet", "Two families. One dance floor. No excuses. Festive Indian wear; suggested colors: emerald, pink, indigo and gold.", 25, 19, 0, 4),
		event("Varmala and Vows", "Baraat", "11:00 AM onwards · Garlands, promises and seven steps together. Suggested colors: maroon, blush, gold and ivory.", 26, 11, 0, 5),
		event("Shaam Shandar", "Reception", "An evening of blessings, lights and celebration. Suggested colors: plum, navy, rose and gold.", 26, 19, 0, 4),
	}
	for _, event := range events {
		var existing Record
		err := collection.FindOne(ctx, bson.M{"weddingId": "sharma-wedding", "type": "event", "title": event.Title}).Decode(&existing)
		if errors.Is(err, mongo.ErrNoDocuments) {
			if _, err = collection.InsertOne(ctx, event); err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		if existing.EndsAt == nil {
			updates := bson.M{"endsAt": event.EndsAt}
			if existing.Event == "" {
				updates["event"] = event.Event
			}
			if existing.Venue == "" {
				updates["venue"] = event.Venue
			}
			if existing.Details == "" {
				updates["details"] = event.Details
			} else if !strings.Contains(existing.Details, "Suggested colors:") {
				if colorsAt := strings.Index(event.Details, "Suggested colors:"); colorsAt >= 0 {
					updates["details"] = strings.TrimSpace(existing.Details + " " + event.Details[colorsAt:])
				}
			}
			updates["updatedAt"] = time.Now().UTC()
			if _, err = collection.UpdateOne(ctx, bson.M{"_id": existing.ID, "weddingId": "sharma-wedding"}, bson.M{"$set": updates}); err != nil {
				return err
			}
		}
	}
	return nil
}

func timePtr(t time.Time) *time.Time { return &t }

func (a *App) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == a.allowedOrigin {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Wedding-Slug")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (w *statusRecorder) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusRecorder) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(data)
}

func (a *App) logAPIRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api" && !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(recorder, r)
		status := recorder.status
		if status == 0 {
			status = http.StatusOK
		}
		log.Printf("API %s %s -> %d (%s)", r.Method, r.URL.Path, status, time.Since(started).Round(time.Millisecond))
	})
}

func (a *App) requireIdentity(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, err := a.authenticate(r)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "Sign in with Google to continue")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey{}, id)))
	})
}

func (a *App) requireUser(next http.Handler) http.Handler {
	return a.requireIdentity(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Context().Value(userKey{}).(identity)
		slug := a.requestedWedding(r)
		allowed, err := a.isFamilyMember(r.Context(), id.Email, slug)
		if err == nil && !allowed {
			allowed, err = a.isAdmin(r.Context(), id.Email, slug)
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Could not check wedding access")
			return
		}
		if !allowed {
			writeError(w, http.StatusForbidden, "This Google account does not have access to this wedding. Ask a wedding admin to add it.")
			return
		}
		ctx := context.WithValue(r.Context(), weddingKey{}, slug)
		next.ServeHTTP(w, r.WithContext(ctx))
	}))
}
func (a *App) requireAdmin(next http.Handler) http.Handler {
	return a.requireUser(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Context().Value(userKey{}).(identity)
		allowed, err := a.isAdmin(r.Context(), id.Email, a.requestedWedding(r))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Could not check admin access")
			return
		}
		if !allowed {
			writeError(w, http.StatusForbidden, "Admin access required")
			return
		}
		next.ServeHTTP(w, r)
	}))
}

type userKey struct{}
type weddingKey struct{}

func (a *App) requestedWedding(r *http.Request) string {
	if slug, ok := r.Context().Value(weddingKey{}).(string); ok && slug != "" {
		return slug
	}
	if slug := strings.TrimSpace(r.Header.Get("X-Wedding-Slug")); slug != "" {
		return slug
	}
	return a.defaultWedding
}

func (a *App) authenticate(r *http.Request) (identity, error) {
	parts := strings.Fields(r.Header.Get("Authorization"))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return identity{}, errors.New("missing token")
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	payload, err := idtoken.Validate(ctx, parts[1], a.googleClientID)
	if err != nil {
		return identity{}, err
	}
	email, _ := payload.Claims["email"].(string)
	verified, _ := payload.Claims["email_verified"].(bool)
	if !verified {
		verifiedString, _ := payload.Claims["email_verified"].(string)
		verified = verifiedString == "true"
	}
	name, _ := payload.Claims["name"].(string)
	id := identity{Email: email, Name: name}
	if id.Email == "" || !verified {
		return identity{}, errors.New("untrusted identity")
	}
	return id, nil
}

func bootstrapFamilyMembers(ctx context.Context, db *mongo.Database, emails map[string]bool, weddingID string) error {
	collection := db.Collection("family_members")
	count, err := collection.CountDocuments(ctx, bson.M{"weddingId": weddingID})
	if err != nil || count > 0 {
		return err
	}
	if len(emails) == 0 {
		return nil
	}
	now := time.Now().UTC()
	seed := make([]any, 0, len(emails))
	for email := range emails {
		seed = append(seed, FamilyMember{WeddingID: weddingID, Email: email, CreatedAt: now, CreatedBy: "bootstrap", Active: true})
	}
	_, err = collection.InsertMany(ctx, seed)
	return err
}

func (a *App) isFamilyMember(ctx context.Context, email, weddingID string) (bool, error) {
	count, err := a.db.Collection("family_members").CountDocuments(ctx, bson.M{"weddingId": weddingID, "email": strings.ToLower(strings.TrimSpace(email)), "active": true}, options.Count().SetLimit(1))
	return count > 0, err
}

func (a *App) listFamilyMembers(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	cur, err := a.db.Collection("family_members").Find(ctx, bson.M{"weddingId": a.requestedWedding(r), "active": true}, options.Find().SetSort(bson.D{{Key: "email", Value: 1}}))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not load family access list")
		return
	}
	defer cur.Close(ctx)
	members := []FamilyMember{}
	if err = cur.All(ctx, &members); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not read family access list")
		return
	}
	writeJSON(w, http.StatusOK, members)
}

func (a *App) addFamilyMember(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	email := strings.ToLower(strings.TrimSpace(request.Email))
	parsed, err := mail.ParseAddress(email)
	if err != nil || parsed.Address != email {
		writeError(w, http.StatusBadRequest, "Enter a valid email address")
		return
	}
	actor := r.Context().Value(userKey{}).(identity)
	weddingID := a.requestedWedding(r)
	member := FamilyMember{WeddingID: weddingID, Email: email, CreatedAt: time.Now().UTC(), CreatedBy: strings.ToLower(actor.Email), Active: true}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	_, err = a.db.Collection("family_members").UpdateOne(ctx, bson.M{"weddingId": weddingID, "email": email}, bson.M{"$set": bson.M{"active": true}, "$setOnInsert": bson.M{"weddingId": weddingID, "email": email, "createdAt": member.CreatedAt, "createdBy": member.CreatedBy}}, options.Update().SetUpsert(true))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not grant family access")
		return
	}
	if err = a.db.Collection("family_members").FindOne(ctx, bson.M{"weddingId": weddingID, "email": email}).Decode(&member); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not read family access")
		return
	}
	writeJSON(w, http.StatusCreated, member)
}

func (a *App) removeFamilyMember(w http.ResponseWriter, r *http.Request) {
	email := strings.ToLower(strings.TrimSpace(r.PathValue("email")))
	actor := r.Context().Value(userKey{}).(identity)
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	result, err := a.db.Collection("family_members").UpdateOne(ctx, bson.M{"weddingId": a.requestedWedding(r), "email": email, "active": true}, bson.M{"$set": bson.M{"active": false, "updatedAt": time.Now().UTC(), "updatedBy": strings.ToLower(actor.Email)}})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not remove family access")
		return
	}
	if result.MatchedCount == 0 {
		writeError(w, http.StatusNotFound, "Family email not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func bootstrapAdmins(ctx context.Context, db *mongo.Database, emails map[string]bool, weddingID string) error {
	collection := db.Collection("admins")
	count, err := collection.CountDocuments(ctx, bson.M{"weddingId": weddingID})
	if err != nil || count > 0 {
		return err
	}
	if len(emails) == 0 {
		return errors.New("admins collection is empty; set at least one ADMIN_EMAILS address to bootstrap access")
	}
	createdAt := time.Now().UTC()
	seed := make([]any, 0, len(emails))
	for email := range emails {
		seed = append(seed, Admin{WeddingID: weddingID, Email: email, CreatedAt: createdAt, CreatedBy: "bootstrap"})
	}
	_, err = collection.InsertMany(ctx, seed)
	return err
}

func (a *App) isAdmin(ctx context.Context, email, weddingID string) (bool, error) {
	count, err := a.db.Collection("admins").CountDocuments(ctx, bson.M{"weddingId": weddingID, "email": strings.ToLower(strings.TrimSpace(email))}, options.Count().SetLimit(1))
	return count > 0, err
}

func (a *App) listAdmins(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	cur, err := a.db.Collection("admins").Find(ctx, bson.M{"weddingId": a.requestedWedding(r)}, options.Find().SetSort(bson.D{{Key: "email", Value: 1}}))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not load admins")
		return
	}
	defer cur.Close(ctx)
	admins := []Admin{}
	if err = cur.All(ctx, &admins); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not read admins")
		return
	}
	writeJSON(w, http.StatusOK, admins)
}

func (a *App) addAdmin(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	email := strings.ToLower(strings.TrimSpace(request.Email))
	parsed, err := mail.ParseAddress(email)
	if err != nil || parsed.Address != email {
		writeError(w, http.StatusBadRequest, "Enter a valid email address")
		return
	}
	identity := r.Context().Value(userKey{}).(identity)
	weddingID := a.requestedWedding(r)
	admin := Admin{WeddingID: weddingID, Email: email, CreatedAt: time.Now().UTC(), CreatedBy: strings.ToLower(identity.Email)}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	if _, err = a.db.Collection("admins").InsertOne(ctx, admin); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			writeError(w, http.StatusConflict, "This email already has admin access")
			return
		}
		writeError(w, http.StatusInternalServerError, "Could not grant admin access")
		return
	}
	writeJSON(w, http.StatusCreated, admin)
}

func (a *App) removeAdmin(w http.ResponseWriter, r *http.Request) {
	a.adminLock.Lock()
	defer a.adminLock.Unlock()
	email := strings.ToLower(strings.TrimSpace(r.PathValue("email")))
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	admins := a.db.Collection("admins")
	weddingID := a.requestedWedding(r)
	var wedding Wedding
	if err := a.db.Collection("weddings").FindOne(ctx, bson.M{"slug": weddingID}).Decode(&wedding); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not load wedding settings")
		return
	}
	if strings.EqualFold(email, wedding.MainAdminEmail) {
		writeError(w, http.StatusConflict, "Transfer main admin status before removing this admin")
		return
	}
	count, err := admins.CountDocuments(ctx, bson.M{"weddingId": weddingID})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not check admin list")
		return
	}
	if count <= 1 {
		writeError(w, http.StatusConflict, "The last admin cannot be removed")
		return
	}
	result, err := admins.DeleteOne(ctx, bson.M{"weddingId": weddingID, "email": email})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not remove admin access")
		return
	}
	if result.DeletedCount == 0 {
		writeError(w, http.StatusNotFound, "Admin email not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *App) listTasks(w http.ResponseWriter, r *http.Request)        { a.listByType(w, r, "task") }
func (a *App) listPublicEvents(w http.ResponseWriter, r *http.Request) { a.listByType(w, r, "event") }
func (a *App) listBudget(w http.ResponseWriter, r *http.Request)       { a.listByType(w, r, "budget") }
func (a *App) listByType(w http.ResponseWriter, r *http.Request, typ string) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	filter := workspaceFilter(a.requestedWedding(r), bson.M{"type": typ})
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		filter["$or"] = bson.A{bson.M{"title": bson.M{"$regex": q, "$options": "i"}}, bson.M{"details": bson.M{"$regex": q, "$options": "i"}}, bson.M{"area": bson.M{"$regex": q, "$options": "i"}}}
	}
	cur, err := a.db.Collection("records").Find(ctx, filter, options.Find().SetSort(bson.D{{Key: "updatedAt", Value: -1}}))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not load records")
		return
	}
	defer cur.Close(ctx)
	items := []Record{}
	if err = cur.All(ctx, &items); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not read records")
		return
	}
	writeJSON(w, http.StatusOK, items)
}
func (a *App) createTask(w http.ResponseWriter, r *http.Request) { a.createRecord(w, r, "task") }
func (a *App) createBudgetItem(w http.ResponseWriter, r *http.Request) {
	a.createRecord(w, r, "budget")
}
func (a *App) createRecord(w http.ResponseWriter, r *http.Request, typ string) {
	var rec Record
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&rec); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	if strings.TrimSpace(rec.Title) == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	if rec.ParentID != nil {
		if typ != "budget" {
			writeError(w, http.StatusBadRequest, "Only budget details can have a parent")
			return
		}
		var parent Record
		ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
		defer cancel()
		err := a.db.Collection("records").FindOne(ctx, workspaceFilter(a.requestedWedding(r), bson.M{"_id": *rec.ParentID, "type": "budget", "parentId": bson.M{"$exists": false}})).Decode(&parent)
		if err != nil {
			if err == mongo.ErrNoDocuments {
				writeError(w, http.StatusBadRequest, "Choose an existing top-level budget item")
			} else {
				writeError(w, http.StatusInternalServerError, "Could not validate parent budget item")
			}
			return
		}
		if rec.Event == "" {
			rec.Event = parent.Event
		}
	} else {
		rec.ParentID = nil
	}
	if typ == "task" && strings.TrimSpace(rec.AssigneeEmail) != "" {
		rec.AssigneeEmail = strings.ToLower(strings.TrimSpace(rec.AssigneeEmail))
		if _, err := mail.ParseAddress(rec.AssigneeEmail); err != nil {
			writeError(w, http.StatusBadRequest, "assigneeEmail must be a valid workspace email")
			return
		}
		count, err := a.db.Collection("workspace_users").CountDocuments(r.Context(), bson.M{"weddingId": a.requestedWedding(r), "email": rec.AssigneeEmail}, options.Count().SetLimit(1))
		if err != nil || count == 0 {
			writeError(w, http.StatusBadRequest, "Choose a member who has signed into the workspace")
			return
		}
	}
	rec.ID = primitive.NewObjectID()
	rec.WeddingID = a.requestedWedding(r)
	rec.Type = typ
	rec.UpdatedAt = time.Now().UTC()
	if id, ok := r.Context().Value(userKey{}).(identity); ok {
		rec.CreatedBy = id.Email
		rec.CreatedByName = id.Name
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	if _, err := a.db.Collection("records").InsertOne(ctx, rec); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not save record")
		return
	}
	writeJSON(w, http.StatusCreated, rec)
}
func (a *App) createCollectionRecord(w http.ResponseWriter, r *http.Request) {
	collection := r.PathValue("collection")
	if !allowedCollection(collection) {
		writeError(w, http.StatusNotFound, "Unknown collection")
		return
	}
	a.createRecord(w, r, collection)
}
func (a *App) listCollection(w http.ResponseWriter, r *http.Request) {
	collection := r.PathValue("collection")
	if !allowedCollection(collection) || collection == "budget" {
		writeError(w, http.StatusNotFound, "Unknown collection")
		return
	}
	a.listByType(w, r, collection)
}
func allowedCollection(s string) bool {
	return s == "guests" || s == "stays" || s == "transport" || s == "event" || s == "notifications"
}
func (a *App) updateTask(w http.ResponseWriter, r *http.Request) {
	a.updateRecord(w, r, "task")
}

func (a *App) updateTransport(w http.ResponseWriter, r *http.Request) {
	a.updateRecord(w, r, "transport")
}

func (a *App) deleteTask(w http.ResponseWriter, r *http.Request) { a.deleteRecord(w, r, "task") }
func (a *App) updateBudgetItem(w http.ResponseWriter, r *http.Request) {
	a.updateRecord(w, r, "budget")
}
func (a *App) deleteBudgetItem(w http.ResponseWriter, r *http.Request) {
	id, err := primitive.ObjectIDFromHex(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid record id")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	if _, err = a.db.Collection("records").DeleteMany(ctx, bson.M{"weddingId": a.requestedWedding(r), "type": "budget", "parentId": id}); err != nil {
		writeError(w, http.StatusInternalServerError, "Could not remove budget details")
		return
	}
	a.deleteRecord(w, r, "budget")
}

func (a *App) updateCollectionRecord(w http.ResponseWriter, r *http.Request) {
	collection := r.PathValue("collection")
	if !allowedCollection(collection) {
		writeError(w, http.StatusNotFound, "Unknown collection")
		return
	}
	a.updateRecord(w, r, collection)
}

func (a *App) deleteCollectionRecord(w http.ResponseWriter, r *http.Request) {
	collection := r.PathValue("collection")
	if !allowedCollection(collection) {
		writeError(w, http.StatusNotFound, "Unknown collection")
		return
	}
	a.deleteRecord(w, r, collection)
}

func (a *App) updateRecord(w http.ResponseWriter, r *http.Request, recordType string) {
	id, err := primitive.ObjectIDFromHex(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid task id")
		return
	}
	var patch bson.M
	if err = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&patch); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	for key := range patch {
		if key != "title" && key != "area" && key != "owner" && key != "assigneeEmail" && key != "dueAt" && key != "endsAt" && key != "startsAt" && key != "status" && key != "details" && key != "event" && key != "amount" && key != "notificationKind" && key != "venue" && key != "latitude" && key != "longitude" && key != "checkedIn" {
			delete(patch, key)
		}
	}
	if title, ok := patch["title"].(string); ok && strings.TrimSpace(title) == "" {
		writeError(w, http.StatusBadRequest, "title cannot be empty")
		return
	}
	if assignee, ok := patch["assigneeEmail"].(string); ok && strings.TrimSpace(assignee) != "" {
		assignee = strings.ToLower(strings.TrimSpace(assignee))
		if _, parseErr := mail.ParseAddress(assignee); parseErr != nil {
			writeError(w, http.StatusBadRequest, "assigneeEmail must be a valid workspace email")
			return
		}
		count, countErr := a.db.Collection("workspace_users").CountDocuments(r.Context(), bson.M{"weddingId": a.requestedWedding(r), "email": assignee}, options.Count().SetLimit(1))
		if countErr != nil || count == 0 {
			writeError(w, http.StatusBadRequest, "Choose a member who has signed into the workspace")
			return
		}
		patch["assigneeEmail"] = assignee
	}
	for _, key := range []string{"dueAt", "startsAt", "endsAt"} {
		if value, ok := patch[key]; ok {
			if value == nil || value == "" {
				patch[key] = nil
				continue
			}
			dateText, ok := value.(string)
			if !ok {
				writeError(w, http.StatusBadRequest, key+" must be an ISO date")
				return
			}
			parsed, parseErr := time.Parse(time.RFC3339, dateText)
			if parseErr != nil {
				parsed, parseErr = time.Parse("2006-01-02", dateText)
			}
			if parseErr != nil {
				writeError(w, http.StatusBadRequest, key+" must be an ISO date")
				return
			}
			patch[key] = parsed.UTC()
		}
	}
	if amount, ok := patch["amount"].(float64); ok {
		patch["amount"] = int64(amount)
	}
	if checkedIn, ok := patch["checkedIn"].(bool); ok {
		if recordType != "stays" {
			writeError(w, http.StatusBadRequest, "Check-in status is only supported for room assignments")
			return
		}
		id := r.Context().Value(userKey{}).(identity)
		if checkedIn {
			patch["checkedInAt"] = time.Now().UTC()
			patch["checkedInBy"] = strings.ToLower(id.Email)
		} else {
			patch["checkedInAt"] = nil
			patch["checkedInBy"] = ""
		}
		patch["updatedBy"] = strings.ToLower(id.Email)
	}
	patch["updatedAt"] = time.Now().UTC()
	patch["updatedBy"] = strings.ToLower(r.Context().Value(userKey{}).(identity).Email)
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	result, err := a.db.Collection("records").UpdateOne(ctx, workspaceFilter(a.requestedWedding(r), bson.M{"_id": id, "type": recordType}), bson.M{"$set": patch})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not update record")
		return
	}
	if result.MatchedCount == 0 {
		writeError(w, http.StatusNotFound, "Record not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (a *App) deleteRecord(w http.ResponseWriter, r *http.Request, recordType string) {
	id, err := primitive.ObjectIDFromHex(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid record id")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	result, err := a.db.Collection("records").DeleteOne(ctx, workspaceFilter(a.requestedWedding(r), bson.M{"_id": id, "type": recordType}))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Could not delete record")
		return
	}
	if result.DeletedCount == 0 {
		writeError(w, http.StatusNotFound, "Record not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
