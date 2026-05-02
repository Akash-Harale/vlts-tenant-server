const roleModel = require("../models/roleModel");

exports.getRoles = async (req, res, next) => {
  try {
    const roles = await roleModel.find({
      scope: req.user.employee_id.scope,
    });
    res.json(roles);
  } catch (err) {
    console.error("[rolesController] Get roles error:", err.message, err.stack);
    await logger.error(
      req.user?.employee_id,
      req.user?.id,
      req.user?.role,
      err,
      "user",
      null,
      null,
      500,
    );
    next(err);
  }
};
