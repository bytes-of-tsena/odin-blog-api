import { Request, Response } from "express";
import _ from "lodash";
import { isValidObjectId } from "mongoose";
import { matchedData } from "express-validator";
import { CommentModel } from "../models/comment";
import {
  CommentReqBody,
  CommentUpdateReqBody,
} from "../request-bodies/comment";
import { JwtPayload } from "../middleware/interfaces";
import {
  commentBodyValidator,
  commentUpdateReqBodyValidators,
  idSanitizers,
  postIdSanitizer,
} from "../validators/comments";
import Utility from "../utilities";

const commentController = {
  getCommentById: [
    ...idSanitizers,
    Utility.validateRequest,
    async function (req: Request, res: Response) {
      try {
        const sanitizedData = matchedData(req);
        const { postId, id: commentId } = sanitizedData;
        if (!isValidObjectId(postId)) {
          return res.status(400).json({
            message: `Post id, ${postId}, is invalid or malformed.`,
          });
        }
        if (!isValidObjectId(commentId)) {
          return res.status(400).json({
            message: `Comment id, ${commentId}, is invalid or malformed.`,
          });
        }

        const storedComment = await CommentModel.findOne({
          _id: commentId,
          post: postId,
        });
        if (!storedComment) {
          return res.status(404).json({
            message: `comment with id, ${commentId}, and post id, ${postId}, was not found.`,
          });
        }
        return res.status(200).json({
          message: "comment retrieved successfully",
          comment: storedComment,
        });
      } catch (e) {
        console.error(`Error fetching comment by id: ${e}`);
        return res.status(500).json({
          message:
            process.env.NODE_ENV === "production"
              ? "Internal server error occurred. Please try again later."
              : (e as Error).message,
        });
      }
    },
  ],
  getComments: [
    postIdSanitizer,
    Utility.validateRequest,
    async function (req: Request, res: Response) {
      try {
        const sanitizedData = matchedData(req);
        const { postId } = sanitizedData;
        if (!isValidObjectId(postId)) {
          return res.status(400).json({
            message: `Post id, ${postId}, is invalid or malformed.`,
          });
        }

        const storedComments = await CommentModel.find({
          post: postId,
        });
        if (storedComments.length === 0) {
          return res.status(200).json({
            message: `No comments available for post with id, ${postId}.`,
          });
        }
        return res.status(200).json({
          message: "post comments fetched successfully",
          comments: storedComments,
        });
      } catch (e) {
        console.error(`Error fetching comments: ${e}`);
        return res.status(500).json({
          message:
            process.env.NODE_ENV === "production"
              ? "Internal server error occurred. Please try again later."
              : (e as Error).message,
        });
      }
    },
  ],
  createComment: [
    postIdSanitizer,
    ...commentBodyValidator,
    Utility.validateRequest,
    async function (req: Request, res: Response) {
      try {
        const sanitizedData = matchedData(req);
        const { postId } = sanitizedData;
        if (!isValidObjectId(postId)) {
          return res.status(400).json({
            message: `Post id, ${postId}, is invalid or malformed.`,
          });
        }

        const { data } = (req.user! as any).data as JwtPayload;
        const { sub } = data;
        const reqBody: CommentReqBody = {
          user: sub,
          post: postId,
          ...req.body,
        } as const;
        const createdComment = await CommentModel.create({
          ...reqBody,
        });
        return res.status(201).json({
          message: "comment created successfully",
          comment: createdComment,
        });
      } catch (e) {
        console.error(`Error creating comment: ${e}`);
        return res.status(500).json({
          message:
            process.env.NODE_ENV === "production"
              ? "Internal server error occurred. Please try again later."
              : (e as Error).message,
        });
      }
    },
  ],
  updateComment: [
    ...idSanitizers,
    ...commentUpdateReqBodyValidators,
    Utility.validateRequest,
    async function (req: Request, res: Response) {
      try {
        const sanitizedData = matchedData(req);
        const { postId, id: commentId } = sanitizedData;
        if (!isValidObjectId(postId)) {
          return res.status(400).json({
            message: `Post id, ${postId}, is invalid or malformed.`,
          });
        }
        if (!isValidObjectId(commentId)) {
          return res.status(400).json({
            message: `Comment id, ${commentId}, is invalid or malformed.`,
          });
        }

        let storedComment = await CommentModel.findOne({
          _id: commentId,
          post: postId,
        });
        if (!storedComment) {
          return res.status(404).json({
            message: `comment with id, ${commentId}, and post id, ${postId}, was not found.`,
          });
        }

        // check author
        const { data } = (req.user! as any).data as JwtPayload;
        const { sub } = data;
        if (sub !== storedComment.user.toHexString()) {
          return res.status(403).json({
            message:
              "you are not the author of this post so you will not update it",
          });
        }

        storedComment = _.merge(
          storedComment,
          req.body as CommentUpdateReqBody
        );
        await storedComment!.save();
        return res.status(200).json({
          message: "post comment updated successfully",
          comment: storedComment,
        });
      } catch (e) {
        console.error(`Error updating a comment: ${e}`);
        return res.status(500).json({
          message:
            process.env.NODE_ENV === "production"
              ? "Internal server error occurred. Please try again later."
              : (e as Error).message,
        });
      }
    },
  ],
  deleteComment: [
    ...idSanitizers,
    Utility.validateRequest,
    async function (req: Request, res: Response) {
      try {
        const sanitizedData = matchedData(req);
        const { postId, id: commentId } = sanitizedData;
        if (!isValidObjectId(postId)) {
          return res.status(400).json({
            message: `Post id, ${postId}, is invalid or malformed.`,
          });
        }
        if (!isValidObjectId(commentId)) {
          return res.status(400).json({
            message: `Comment id, ${commentId}, is invalid or malformed.`,
          });
        }

        const storedComment = await CommentModel.findOne({
          _id: commentId,
          post: postId,
        });
        if (!storedComment) {
          return res.status(404).json({
            message: `comment with id, ${commentId}, and post id, ${postId}, was not found.`,
          });
        }

        // check author
        const { data } = (req.user! as any).data as JwtPayload;
        const { sub } = data;
        if (sub !== storedComment.user.toHexString()) {
          return res.status(403).json({
            message:
              "you are not the author of this post so you will not delete it",
          });
        }

        await storedComment.deleteOne();
        return res.status(204).json({});
      } catch (e) {
        console.error(`Error deleting a comment: ${e}`);
        return res.status(500).json({
          message:
            process.env.NODE_ENV === "production"
              ? "Internal server error occurred. Please try again later."
              : (e as Error).message,
        });
      }
    },
  ],
};
export default commentController;
