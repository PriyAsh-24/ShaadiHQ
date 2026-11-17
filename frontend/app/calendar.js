function googleCalendarURL(title, dueAt, details = "") {
  const date = new Date(dueAt);
  const start = date.toISOString().slice(0, 10).replaceAll("-", "");
  const next = new Date(date.getTime() + 86400000).toISOString().slice(0, 10).replaceAll("-", "");
  const params = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${start}/${next}`, details });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function googleCalendarEventURL(title, startsAt, endsAt, location = "", details = "") {
  const start = new Date(startsAt);
  const end = endsAt ? new Date(endsAt) : new Date(start.getTime() + 60 * 60 * 1000);
  const compact = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${compact(start)}/${compact(end)}`, location, details });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

module.exports = { googleCalendarURL, googleCalendarEventURL };
