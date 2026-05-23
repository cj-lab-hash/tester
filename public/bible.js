export async function loadVerseFromAPI() {
  try {
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Manila"
    });

    const cacheKey = `verse-${today}`;
    const historyKey = "verse-history";

    const cached = localStorage.getItem(cacheKey);

    if (cached) {
      const { reference, text } = JSON.parse(cached);
      showVerse(reference, text);
      return;
    }

    let history = JSON.parse(localStorage.getItem(historyKey)) || [];
    let attempts = 0;
    let reference, text;

    while (attempts < 5) {
      const res = await fetch("https://bible-api.com/?random=verse");
      if (!res.ok) throw new Error("API failed");

      const data = await res.json();

      reference = data.reference;
      text = (data.verses || []).map(v => v.text.trim()).join(" ");

      if (history.includes(reference)) break;
        attemps++;
        
      }
      showVerse(reference, text);

      localStorage.setItem(cacheKey, JSON.stringify({ reference, text }));
      history.push(reference);
      history = history.slice(-10);
      localStorage.setItem(historyKey, JSON.stringify(history));
  } catch (err) {
    console.error("Bible API error:", err);
  }
}

function showVerse(reference, text) {
      document.getElementById("verseRef").textContent = reference;
      document.getElementById("verseText").textContent = `“${text}”`;
    }

setInterval(() => {
  const card = document.querySelector(".verse-card");

  if (card) card.style.opacity = 0;

  setTimeout(() => {
    const today= new Date().toLocaleDateString("en-CA", {
  timeZone: "Asia/Manila"
});


localStorage.removeItem(`verse-${today}`);
loadVerseFromAPI();

if (card) card.style.opacity = 1;
  }, 300);

}, 60 * 60 * 1000); // every 1 hour

