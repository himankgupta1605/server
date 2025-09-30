const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const xlsx = require("xlsx");
const nodemailer = require("nodemailer");
require("dotenv").config();

const Participant = require("./models/Participant");
const Team = require("./models/Team");

const app = express();
app.use(bodyParser.json());
app.use(cors());

// -------------------- DB CONNECTION --------------------
mongoose
  .connect("mongodb://127.0.0.1:27017/hackathon_db")
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// -------------------- SMTP CONFIG --------------------
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: process.env.SMTP_PORT || 465,
  secure: true, // true only if port = 465
  auth: {
    user: process.env.SMTP_USER || "innotech@kiet.edu",
    pass: process.env.SMTP_PASS || ""
  },
  tls: {
    ciphers: "SSLv3"
  }
});

transporter.verify((err) => {
  if (err) console.error("❌ SMTP Error:", err.message);
  else console.log("📧 SMTP server ready");
});

// -------------------- HELPERS --------------------
function normalizeRow(row) {
  const columnMappings = {
    rollnumber: ["Roll Number", "University Roll Number", "UNI ROLL NO"],
    name: ["Display Name", "NAME", "Full Name"],
    email: ["KIET EMAIL", "Institute Email ID", "Email"],
    phone: ["Mobile Number", "MOB", "Phone"],
    branch: ["Branch", "DEPT", "Degree", "Department"],
    course: ["COURSE", "Program"],
    year: ["Current Year", "YEAR", "Year of Study"]
  };

  const normalized = {};

  for (const key in columnMappings) {
    for (const col of columnMappings[key]) {
      const matchedKey = Object.keys(row).find(
        (k) => k.trim().toLowerCase() === col.trim().toLowerCase()
      );
      if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== null) {
        normalized[key] = row[matchedKey];
        break;
      }
    }
  }

  return normalized;
}

function findStudentByRollNumber(rollnumber) {
  const excelFiles = [
    "./data/bp2.xlsx",
    "./data/bt2.xlsx",
    "./data/bt3-4,bp3-4.xlsx",
    "./data/mba2.xlsx",
    "./data/mca2.xlsx"
  ];

  for (const file of excelFiles) {
    const workbook = xlsx.readFile(file);
    const sheetName = workbook.SheetNames[0];
    const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    for (const row of sheetData) {
      const student = normalizeRow(row);
      if (
        student.rollnumber?.toString().trim().toLowerCase() ===
        rollnumber.toString().trim().toLowerCase()
      ) {
        return student;
      }
    }
  }
  return null;
}

// -------------------- ROUTES --------------------

// 🔎 Check roll number
app.post("/check-roll", async (req, res) => {
  try {
    const { rollnumber } = req.body;
    if (!rollnumber) {
      return res.status(400).json({ success: false, error: "Roll number is required" });
    }

    const studentData = findStudentByRollNumber(rollnumber);

    if (!studentData) {
      return res
        .status(404)
        .json({ success: false, error: "Student not found in Excel sheets" });
    }

    res.json({ success: true, data: studentData });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


app.post("/participants", async (req, res) => {
  try {
    const participant = new Participant(req.body);
    const saved = await participant.save();
    res.status(201).json({ success: true, data: saved });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});


app.get("/participants", async (req, res) => {
  try {
    const { uid } = req.query;

    let participants;
    if (uid) {
      // find a single participant by firebase_uid
      participants = await Participant.findOne({ firebase_uid: uid });
      if (!participants) {
        return res.status(404).json({
          success: false,
          error: `No participant found with UID: ${uid}`
        });
      }
    } else {
      // return all participants
      participants = await Participant.find();
    }

    res.json({ success: true, data: participants });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});



app.post("/teams", async (req, res) => {
  try {
    const { leader, members, team_name } = req.body;

    if (!leader?.uid || !team_name) {
      return res
        .status(400)
        .json({ success: false, error: "Leader UID and team_name are required" });
    }

    // Collect all UIDs
    const allUids = [leader.uid, ...(members?.map((m) => m.uid) || [])];

    // Check if all participants exist
    const foundParticipants = await Participant.find({ firebase_uid: { $in: allUids } });

    if (foundParticipants.length !== allUids.length) {
      const foundUids = foundParticipants.map((p) => p.firebase_uid);
      const missing = allUids.filter((uid) => !foundUids.includes(uid));
      return res.status(400).json({
        success: false,
        error: `These UIDs are not registered as participants: ${missing.join(", ")}`
      });
    }

    const alreadyAssigned = foundParticipants.filter((p) => p.team_id !== null);
    if (alreadyAssigned.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Already assigned: ${alreadyAssigned
          .map((p) => `${p.name || p.firebase_uid} (Team ${p.team_id})`)
          .join(", ")}`
      });
    }

    // Create team
    const team = new Team(req.body);
    const saved = await team.save();

    // Assign team_id to participants
    await Participant.updateMany(
      { firebase_uid: { $in: allUids } },
      { $set: { team_id: saved.team_id } }
    );

    // 📧 Send email to all team members
    const recipients = foundParticipants.map((p) => p.email).filter(Boolean);
    if (recipients.length > 0) {
      const mailOptions = {
        from: `"Innotech Hackathon" <${process.env.SMTP_USER}>`,
        to: recipients.join(","), // send to all members
        subject: "✅ Team Registration Successful",
        html: `
          <h2>🎉 Team Registration Successful</h2>
          <p>Your team <b>${saved.team_name}</b> has been registered successfully.</p>
          <p><b>Team ID:</b> ${saved.team_id}</p>
          <p>Good luck in the hackathon 🚀</p>
        `
      };

      try {
        await transporter.sendMail(mailOptions);
        console.log("📧 Mail sent to:", recipients);
      } catch (mailErr) {
        console.error("❌ Mail error:", mailErr.message);
      }
    }

    res.status(201).json({ success: true, data: saved });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get("/teams", async (req, res) => {
  try {
    const { team_id } = req.query;

    let teams;
    if (team_id) {
      teams = await Team.findOne({ team_id: Number(team_id) });
      if (!teams) {
        return res.status(404).json({
          success: false,
          error: `No team found with ID: ${team_id}`
        });
      }
    } else {
      teams = await Team.find();
    }

    res.json({ success: true, data: teams });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------- START SERVER --------------------
app.listen(5000, "0.0.0.0", () =>
  console.log("🚀 Server running on http://0.0.0.0:5000")
);
