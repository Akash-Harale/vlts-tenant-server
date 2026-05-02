const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const rolesController = require("../controllers/rolesController");

// GET /api/roles → List all roles
router.get("/", authMiddleware(["read_roles"]), rolesController.getRoles);

module.exports = router;