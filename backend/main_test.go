package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

func TestLegacyBudgetRecordHasNoParentID(t *testing.T) {
	wantID := primitive.NewObjectID()
	document, err := bson.Marshal(bson.M{"_id": wantID, "type": "budget", "title": "Decoration", "amount": int64(18000)})
	if err != nil {
		t.Fatal(err)
	}
	var record Record
	if err := bson.Unmarshal(document, &record); err != nil {
		t.Fatal(err)
	}
	if record.ParentID != nil {
		t.Fatalf("legacy budget item got a parent ID: %v", record.ParentID)
	}

	encoded, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	var response map[string]any
	if err := json.Unmarshal(encoded, &response); err != nil {
		t.Fatal(err)
	}
	if _, exists := response["parentId"]; exists {
		t.Fatalf("legacy budget response unexpectedly contains parentId: %s", encoded)
	}
}

func TestBudgetChildParentIDRoundTrips(t *testing.T) {
	parentID := primitive.NewObjectID()
	document, err := bson.Marshal(Record{Type: "budget", Title: "Flowers", ParentID: &parentID})
	if err != nil {
		t.Fatal(err)
	}
	var record Record
	if err := bson.Unmarshal(document, &record); err != nil {
		t.Fatal(err)
	}
	if record.ParentID == nil || *record.ParentID != parentID {
		t.Fatalf("child parent ID = %v, want %s", record.ParentID, parentID.Hex())
	}
	encoded, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	var response map[string]any
	if err := json.Unmarshal(encoded, &response); err != nil {
		t.Fatal(err)
	}
	if got := response["parentId"]; got != parentID.Hex() {
		t.Fatalf("JSON parentId = %v, want %s", got, parentID.Hex())
	}
}

func TestAPILoggerRecordsMethodPathAndStatusWithoutQuery(t *testing.T) {
	var output bytes.Buffer
	previousOutput := log.Writer()
	log.SetOutput(&output)
	defer log.SetOutput(previousOutput)

	app := &App{}
	handler := app.logAPIRequests(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
	request := httptest.NewRequest(http.MethodGet, "/api/budget?private=secret", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	line := output.String()
	for _, expected := range []string{"API GET /api/budget -> 418"} {
		if !strings.Contains(line, expected) {
			t.Errorf("API log %q does not contain %q", line, expected)
		}
	}
	if strings.Contains(line, "secret") {
		t.Fatalf("API log must not contain query data: %q", line)
	}
}

func TestWeddingSlug(t *testing.T) {
	for input, expected := range map[string]string{
		"Upadhyay Wedding":    "upadhyay-wedding",
		"  Sharma & Family  ": "sharma-family",
		"123 Celebration":     "123-celebration",
		"शादी":                "",
	} {
		if actual := weddingSlug(input); actual != expected {
			t.Errorf("weddingSlug(%q) = %q, want %q", input, actual, expected)
		}
	}
}

func TestWorkspaceFilterAlwaysScopesToWedding(t *testing.T) {
	filter := workspaceFilter("upadhyay-wedding", bson.M{"type": "budget", "title": "Decoration"})
	if filter["weddingId"] != "upadhyay-wedding" || filter["type"] != "budget" || filter["title"] != "Decoration" {
		t.Fatalf("workspace filter missing scope or requested fields: %#v", filter)
	}
}

func TestEnvFileSearchIncludesDirectoryAboveExecutable(t *testing.T) {
	backendDir := filepath.Join("project", "backend")
	cmdDir := filepath.Join(backendDir, "cmd")
	paths := envFileSearchPaths(".env", cmdDir, filepath.Join(cmdDir, "shaadi_hq.exe"))
	if len(paths) != 2 {
		t.Fatalf("expected current and parent env paths, got %v", paths)
	}
	if paths[0] != filepath.Join(cmdDir, ".env") {
		t.Errorf("first env path = %q, want working-directory .env", paths[0])
	}
	if paths[1] != filepath.Join(backendDir, ".env") {
		t.Errorf("parent env path = %q, want backend .env", paths[1])
	}
}
