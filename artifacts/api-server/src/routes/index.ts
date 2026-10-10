import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import accessRouter from "./access";
import socialRouter from "./social";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accessRouter);
router.use(socialRouter);
router.use(aiRouter);

export default router;
