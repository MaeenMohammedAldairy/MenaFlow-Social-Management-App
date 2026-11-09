import { Router } from "express";
import productMediaRouter from "./product-media";
import productCatalogRouter from "./product-catalog";
import productExtractionsRouter from "./product-extractions";
import productManagementRouter from "./product-management";

const router = Router();
router.use(productMediaRouter);
router.use(productCatalogRouter);
router.use(productExtractionsRouter);
router.use(productManagementRouter);

export default router;
