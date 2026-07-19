const { Router } = require("express");
const controller = require("../controllers/auth.controller");

const router = Router();

router.post("/register", controller.register);
router.post("/login", controller.login);
router.post("/refresh", controller.refresh);
router.get("/verify", controller.verify);

module.exports = router;
