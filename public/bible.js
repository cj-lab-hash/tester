export async function loadVerseFromAPI() {
  try {
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Manila"
    });

    const cacheKey = `verse-${today}`;
    const cached = localStorage.getItem(cacheKey);

    if (cached) {
      const { reference, text } = JSON.parse(cached);
      document.getElementById("verseRef").textContent = reference;
      document.getElementById("verseText").textContent = `“${text}”`;
      return;
    }

    // ✅ Random verse API
    const res = await fetch("https://bible-api.com/?random=verse");
    if (!res.ok) throw new Error("API failed");

    const data = await res.json();

    const text = data.verses.map(v => v.text.trim()).join(" ");
    const reference = data.reference;

    document.getElementById("verseRef").textContent = reference;
    document.getElementById("verseText").textContent = `“${text}”`;

    localStorage.setItem(cacheKey, JSON.stringify({ reference, text }));

  } catch (err) {
    console.error("Bible API error:", err);
  }
}