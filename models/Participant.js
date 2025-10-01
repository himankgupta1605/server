const mongoose = require("mongoose");

const participantSchema = new mongoose.Schema({
  firebase_uid: { type: String, required: true },
  name: String,
  email: String,
  phone: String,
  college: String,
  branch: String,
  year: Number,
  rollnumber: String,
  is_kiet: Boolean,
  course: String,
  picture: { type: Buffer },
  status: { type: String, default: "registered" },
  team_id: { type: Number, default: null },
  role_in_team: { type: String, default: null },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Participant", participantSchema);
