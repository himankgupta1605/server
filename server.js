const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const xlsx = require("xlsx");
const { google } = require("googleapis"); 
require("dotenv").config();

const Participant = require("./models/Participant");
const Team = require("./models/Team");

const app = express();
app.use(bodyParser.json());
app.use(cors());

// -------------------- DB CONNECTION --------------------
mongoose
  .connect("mongodb://admin:admin@64.227.131.109:27017/admin")
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// -------------------- SMTP CONFIG --------------------
const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  "https://developers.google.com/oauthplayground"  // redirect URI used when you generated the refresh token
);
oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

async function sendMail({ to, subject, html }) {
  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

  const raw = Buffer.from(
    "From: Innotech Hackathon <" + process.env.GMAIL_USER + ">\r\n" +
    "To: " + to + "\r\n" +
    "Subject: " + subject + "\r\n" +
    "Content-Type: text/html; charset=utf-8\r\n\r\n" +
    html
  )
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
  console.log("📧 Gmail API mail sent to:", to);
}

// -------------------- HELPERS --------------------
function normalizeRow(row) {
  const columnMappings = {
    rollnumber: ["Roll Number","Number","University Roll Number", "UNI ROLL NO"],
    name: ["Display Name", "NAME", "Full Name"],
    email: ["KIET EMAIL", "Institute Email ID", "Email"],
    phone: ["Mobile Number", "MOB", "Phone"],
    branch: ["Branch", "DEPT", "Degree", "Department"],
    course: ["COURSE", "Program"],
    year: ["Current Year", "YEAR", "Year of Study", "Current", "Year"]
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

  // ✅ Default course handling
  if (!normalized.course || normalized.course.trim() === "") {
    normalized.course = "B.Tech";
  }

  return normalized;
}


function findStudentByRollNumber(rollnumber) {
  const excelFiles = [
    "./data/bp2.xlsx",
    "./data/bt2.xlsx",
    "./data/bt3-4,bp3-4.xlsx",
    "./data/mba2.xlsx",
    "./data/mca2.xlsx",
    "./data/bt1.xlsx",
    "./data/mba1.xlsx"
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
const branchMap = {
  "Advanced Mechatronics and Industrial Automation": "AMIA",
  "Computer Science": "CS",
  "Computer Science and Engineering": "CSE",
  "Computer Science and Engineering (Artificial Intelligence & Machine Learning)": "CSE(AIML)",
  "Computer Science and Engineering (Artificial Intelligence)": "CSE(AI)",
  "Computer Science and Engineering (Cyber Security)": "CSE(CS)",
  "Computer Science and Engineering (Data Science)": "CSE(DS)",
  "Computer Science and Information Technology": "CSIT",
  "Electrical and Computer Engineering": "ECE",
  "Electrical and Electronics Engineering": "EEE",
  "Electronics & Communication Engineering": "ECE",
  "Electronics and Comm. Engg. (VLSI Design and Tech)": "ECE(VLSI)",
  "Information Technology": "IT",
  "Mechanical Engineering": "ME"
};

app.post("/check-roll", async (req, res) => {
  try {
    const { rollnumber } = req.body;
    if (!rollnumber) {
      return res.status(400).json({ success: false, error: "Roll number is required" });
    }

    let studentData = findStudentByRollNumber(rollnumber);

    if (!studentData) {
      return res
        .status(404)
        .json({ success: false, error: "Student not found in Excel sheets" });
    }

    // 🔑 Map branch to short form if it exists in mapping
    if (studentData.branch && branchMap[studentData.branch]) {
      studentData.branch = branchMap[studentData.branch];
    }

    res.json({ success: true, data: studentData });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});



app.post("/participants", async (req, res) => {
  try {
    const { firebase_uid } = req.body;

    if (!firebase_uid) {
      return res.status(400).json({ success: false, error: "firebase_uid is required" });
    }

    // 🔎 Check if participant already exists
    const existing = await Participant.findOne({ firebase_uid });
    if (existing) {
      return res.status(200).json({
        success: true,
        message: "Participant already exists",
        data: existing
      });
    }

    // 🚀 Create new participant
    const participant = new Participant(req.body);
    const saved = await participant.save();

    res.status(201).json({ success: true, data: saved });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});



app.get("/uid", async (req, res) => {
  try {
    const { uid} = req.query;

    // if empty string was passed, just return nothing
    if (uid === "") {
      return res.status(400).json({
        success: false,
        error: "UID or Roll Number cannot be empty"
      });
    }

    let participant;

    if (uid) {
      participant = await Participant.findOne({ firebase_uid: uid });
      if (!participant) {
        return res.status(404).json({
          success: false,
          error: `No participant found with UID: ${uid}`
        });
      }
    }
    res.json({ success: true, data: participant });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/stats", async (req, res) => {
  try {
    // Count total teams
    const totalTeams = await Team.countDocuments();

    // Count total participants
    const totalParticipants = await Participant.countDocuments();

    res.json({
      success: true,
      totalTeams,
      totalParticipants
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


app.get("/rollno", async (req, res) => {
  try {
    const {rollno } = req.query;

    // if empty string was passed, just return nothing
    if (rollno === "") {
      return res.status(400).json({
        success: false,
        error: "UID or Roll Number cannot be empty"
      });
    }

    let participant;

    if (rollno) {
      participant = await Participant.findOne({ rollnumber: rollno });
      if (!participant) {
        return res.status(404).json({
          success: false,
          error: `No participant found with Roll Number: ${rollno}`
        });
      }
    }

    res.json({ success: true, data: participant });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/participants", async (req, res) => {
  try {
  
    let participant;

  
      participant = await Participant.find();


    res.json({ success: true, data: participant });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/teams", async (req, res) => {
  try {
    const { leader, members, team_name } = req.body;

    if (!leader?.uid || !team_name) {
      return res.status(400).json({
        success: false,
        error: "Leader UID and team_name are required",
      });
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
        error: `These UIDs are not registered as participants: ${missing.join(", ")}`,
      });
    }

    // Check if already assigned
    const alreadyAssigned = foundParticipants.filter((p) => p.team_id !== null);
    if (alreadyAssigned.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Already assigned: ${alreadyAssigned
          .map((p) => `${p.name || p.firebase_uid} (Team ${p.team_id})`)
          .join(", ")}`,
      });
    }

   const team = new Team({
  team_name,
  leader: { ...leader, role: "leader" },
  members: members?.map((m) => ({ ...m, role: "member" })) || [],

  // Extra details from req.body
  category_id: req.body.category_id,
  category_name: req.body.category_name,
  problem_statement: req.body.problem_statement,
  department: req.body.department,
  picture: req.body.buffer,
  // Default values
  qualified_for_institute: false,
  departmental_scores: [],
  departmental_final_score: 0,
  college_scores: [],
  college_final_score: 0,
  status: "active",
});
    const saved = await team.save();

    // ✅ Update participants with team_id and role_in_team
    const bulkUpdates = allUids.map((uid) => {
      const role = uid === leader.uid ? "leader" : "member";
      return {
        updateOne: {
          filter: { firebase_uid: uid },
          update: { $set: { team_id: saved.team_id, role_in_team: role } },
        },
      };
    });
    await Participant.bulkWrite(bulkUpdates);

    // 📧 Notify via email
    const recipients = foundParticipants.map((p) => p.email).filter(Boolean);
    if (recipients.length > 0) {
      try {
        await sendMail({
          to: recipients.join(","),
          subject: "Team Registration Successful",
          html: `
            <h2>🎉 Team Registration Successful</h2>
            <p>Your team <b>${saved.team_name}</b> has been registered successfully.</p>
            <p><b>Team ID:</b> ${saved.team_id}</p>
            <h3>Team Members:</h3>
            <ul>
              <li><b>Leader:</b> ${leader.name} (${leader.rollnumber})</li>
              ${members
                .map((m) => `<li><b>Member:</b> ${m.name} (${m.rollnumber})</li>`)
                .join("")}
            </ul>
            <p>Good luck in the hackathon 🚀</p>
          `,
        });
      } catch (mailErr) {
        console.error("❌ Gmail API mail error:", mailErr.message);
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