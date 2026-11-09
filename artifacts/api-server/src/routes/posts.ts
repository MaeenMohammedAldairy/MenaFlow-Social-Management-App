import { Router, type IRouter } from "express";
import postsReadRouter from "./posts-read";
import postsWorkflowRouter from "./posts-workflow";
import postsWriteRouter from "./posts-write";
import postsPublishingRouter from "./posts-publishing";
import postsWhatsAppRouter from "./posts-whatsapp";

const router: IRouter = Router();
router.use(postsReadRouter);
router.use(postsWorkflowRouter);
router.use(postsWriteRouter);
router.use(postsPublishingRouter);
router.use(postsWhatsAppRouter);

export default router;
