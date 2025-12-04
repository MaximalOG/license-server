import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// Your GitHub raw config file (safe because you can change it anytime)
const CONFIG_URL = "https://raw.githubusercontent.com/MaximalOG/bot-configs/refs/heads/main/config.json";

// Fetch config.json from GitHub
async function fetchConfig() {
    const res = await fetch(CONFIG_URL);
    return await res.json();
}

// Root endpoint (to know server is running)
app.get("/", (req, res) => {
    res.send("License server is running!");
});

// Verify license endpoint
app.post("/verify", async (req, res) => {
    try {
        const { key } = req.body;

        if (!key) return res.json({ success: false, error: "Missing key" });

        const config = await fetchConfig();
        const validKeys = config.validKeys || [];

        if (validKeys.includes(key)) {
            return res.json({ success: true, status: "VALID_LICENSE" });
        }

        return res.json({ success: false, status: "INVALID_LICENSE" });

    } catch (err) {
        console.error(err);
        res.json({
            success: false,
            error: "SERVER_ERROR"
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`License server running on port ${PORT}`));
