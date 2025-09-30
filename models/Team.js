const mongoose = require("mongoose");

// -------------------- Unique Team ID --------------------
async function generateUniqueTeamId() {
  const Team = mongoose.model("Team");
  let teamId;
  let exists = true;

  while (exists) {
    teamId = Math.floor(1000 + Math.random() * 9000); // 1000–9999
    const existing = await Team.findOne({ team_id: teamId });
    if (!existing) exists = false;
  }

  return teamId;
}

// -------------------- Subschemas --------------------

// Member / Leader info schema
const MemberSchema = new mongoose.Schema(
  {
    uid: { type: String, required: true }, // firebase_uid
    name: { type: String },
    rollnumber: { type: String },
    branch: { type: String },
  },
  { _id: false }
);

// Category scoring schema
const CategorySchema = new mongoose.Schema(
  {
    subcriteria: { type: Map, of: Number, default: {} },
    total: { type: Number, default: 0 },
  },
  { _id: false }
);

// Judge evaluation schema
const EvaluationSchema = new mongoose.Schema(
  {
    judge_id: { type: String, required: true },
    rubric_scores: {
      "Design & Build Quality": { type: CategorySchema, default: {} },
      "Working Model": { type: CategorySchema, default: {} },
      "Technology & AI Integration": { type: CategorySchema, default: {} },
      "Future Scope & Impact": { type: CategorySchema, default: {} },
      "Query Addressing": { type: CategorySchema, default: {} },
    },
    total_score: { type: Number, default: 0 },
    feedback: { type: String, default: "Auto-generated feedback" },
  },
  { _id: false }
);

// -------------------- Main Team Schema --------------------
const teamSchema = new mongoose.Schema(
  {
    team_id: { type: Number, unique: true }, // ✅ auto-generated
    team_name: { type: String, required: true },

    // Leader details
    leader: { type: MemberSchema, required: true },

    // Team members
    members: { type: [MemberSchema], default: [] },
    team_size: { type: Number },

    category_id: Number,
    category_name: String,
    problem_statement: String,
    department: String,

    qualified_for_institute: { type: Boolean, default: false },

    // Department level evaluations
    departmental_scores: { type: [EvaluationSchema], default: [] },
    departmental_final_score: { type: Number, default: 0 },

    // College level evaluations
    college_scores: { type: [EvaluationSchema], default: [] },
    college_final_score: { type: Number, default: 0 },

    status: { type: String, default: "active" },
  },
  { timestamps: true }
);


teamSchema.pre("save", async function (next) {
  if (!this.team_id) {
    this.team_id = await generateUniqueTeamId();
  }
  next();
});

module.exports = mongoose.model("Team", teamSchema);
