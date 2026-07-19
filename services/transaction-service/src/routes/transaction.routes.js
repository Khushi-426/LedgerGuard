const { Router } = require("express");
const controller = require("../controllers/transaction.controller");
const { requireAuth } = require("../middleware/auth");

const router = Router();

router.post("/", requireAuth, controller.create);
router.get("/:id", requireAuth, controller.getById);
router.get("/", requireAuth, controller.list);

module.exports = router;
