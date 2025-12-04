import express from "express";
import crypto from "crypto";

const app = express();
app.use(express.json());

const SECRET = process.env.LICENSE_SECRET;

// Generate a license key
function generateLicense() {
    return crypto.randomBytes(16).toString("hex");
}

// POST /generate  (You only call this manually through Postman/Insomnia)
app.post("/generate", (req, res) => {

    const auth = req.headers["authorization"];
    if (!auth || auth !== `Bearer ${SECRET}`)
        return res.status(403).json({ error: "Unauthorized" });

    const key = generateLicense();
    savedLicenses.add(key);
    res.json({ license: key });
});

const savedLicenses = new Set();

// GET /verify?license=xxxx
app.get("/verify", (req, res) => {
    const { license } = req.query;

    if (!license)
        return res.status(400).json({ valid: false, error: "No license provided" });

    if (savedLicenses.has(license))
        return res.json({ valid: true });

    res.json({ valid: false });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("License server running on port " + PORT);
});
