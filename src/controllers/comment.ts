import { Request, Response } from "express";
import * as _ from "lodash";
import { Types, isValidObjectId } from "mongoose";
import { matchedData } from "express-validator";
import { CommentModel, CommentModelShape } from "../models/comment";
import {
  commentBodyValidator,
  commentIdSanitizer,
  commentUpdateReqBodyValidators,
  idSanitizers,
  postIdSanitizer,
  replyIdSanitizer,
} from "../validators/comments";
import Utility from "../utilities";
import { startLogger } from "../logging";

// todo: test new routes

const logger = startLogger(__filename);
const commentController = {
  getCommentById: [
    ...idSanitizers,
    Utility.validateRequest,
    async function (req: Request, res: Response): Promise<any> {
      try {
        const storedComment = await findCommentByIdAndPostId(req, res);
        if (!storedComment) return;
        logger.info("comment retrieved successfully!");
        return res.status(200).json({
          message: "comment retrieved successfully",
          comment: storedComment,
        });
      } catch (e) {
        logger.error(e, "Error fetching comment by id");
        Utility.handle500Status(res, <Error>e);
      }
    },
  ],
  getComments: [
    postIdSanitizer,
    Utility.validateRequest,
    async function (req: Request, res: Response): Promise<any> {
      try {
        const storedComments = await findCommentsForPost(req, res);
        if (!storedComments) return;
        logger.info("comments fetched successfully!");
        return res.status(200).json({
          message: "post comments fetched successfully",
          comments: storedComments,
        });
      } catch (e) {
        logger.error(e, "error fetching comments");
        Utility.handle500Status(res, <Error>e);
      }
    },
  ],
  createComment: [
    postIdSanitizer,
    ...commentBodyValidator,
    Utility.validateRequest,
    async function (req: Request, res: Response): Promise<any> {
      try {
        const sanitizedData = matchedData(req);
        const { postId } = sanitizedData;
        if (!Utility.validateObjectId(postId, res)) return;
        const currUserId = Utility.extractUserIdFromToken(req);
        const reqBody: CommentModelShape = {
          user: new Types.ObjectId(<string>currUserId),
          post: new Types.ObjectId(<string>postId),
          ...req.body,
        } as const;
        logger.info(
          `creating a comment for user with id, ${currUserId} and post id, ${postId}...`
        );
        const createdComment = await CommentModel.create({
          ...reqBody,
        });
        logger.info(
          `comment with id, ${createdComment.id}, created successfully!`
        );
        return res.status(201).json({
          message: "comment created successfully",
          comment: createdComment,
        });
      } catch (e) {
        logger.error(e, "error creating comment");
        Utility.handle500Status(res, <Error>e);
      }
    },
  ],
  updateComment: [
    ...idSanitizers,
    ...commentUpdateReqBodyValidators,
    Utility.validateRequest,
    async function (req: Request, res: Response): Promise<any> {
      try {
        const storedComment = await findCommentByIdAndPostId(req, res);
        if (!storedComment) return;
        if (
          !isCurrUserSameAsCreator(
            req,
            res,
            storedComment.user._id.toHexString()
          )
        ) {
          return;
        }
        await Utility.updateDoc(storedComment, req.body);
        logger.info(
          `comment with id, ${storedComment.id}, updated successfully!`
        );
        return res.status(200).json({
          message: "post comment updated successfully",
          comment: storedComment,
        });
      } catch (e) {
        logger.error(e, "error updating a comment");
        Utility.handle500Status(res, <Error>e);
      }
    },
  ],
  deleteComment: [
    ...idSanitizers,
    Utility.validateRequest,
    async function (req: Request, res: Response): Promise<any> {
      try {
        const storedComment = await findCommentByIdAndPostId(req, res);
        if (!storedComment) return;
        if (
          !isCurrUserSameAsCreator(
            req,
            res,
            storedComment!.user._id.toHexString()
          )
        ) {
          return;
        }
        await markCommentAsDeleted(storedComment);
        logger.info(
          `comment with id, ${storedComment.id}, deleted successfully!`
        );
        return res.status(204).end();
      } catch (e) {
        logger.error(e, "error deleting a comment");
        Utility.handle500Status(res, <Error>e);
      }
    },
  ],
  findReplies: [
    postIdSanitizer,
    commentIdSanitizer,
    Utility.validateRequest,
    async function (req: Request, res: Response): Promise<any> {
      try {
        const parentComment = await findParentComment(req, res);
        if (!parentComment) return;

        // is the parent comment deleted?
        if (parentComment.deleted) {
          return res.status(400).json({
            message: `parent comment with id, ${parentComment.id}, is already deleted`,
          });
        }

        // populate child comments
        logger.info(`populating comment's( ${parentComment.id} ) replies...`);
        await parentComment.populate("childComments");
        let replies = parentComment.childComments;
        if (replies.length <= 0) {
          return res.status(404).json({
            message: `no replies added for comment, ${parentComment.id}`,
          });
        }

        // keep replies that are NOT deleted
        replies = replies.filter((currComment) => !(<any>currComment).deleted);

        return res.status(200).json({
          message: "replies retrieved successfully",
          replies,
        });
      } catch (e) {
        logger.error(e, "error finding replies to comment");
        Utility.handle500Status(res, <Error>e);
      }
    },
  ],
  createReply: [
    postIdSanitizer,
    commentIdSanitizer,
    Utility.validateRequest,
    async function (req: Request, res: Response): Promise<any> {
      try {
        // find the parent comment first
        const sanitizedData = matchedData(req);
        const { postId, id: parentCommentId } = sanitizedData;
        const parentComment = await findParentComment(req, res);
        if (!parentComment) return;

        // is the parent comment deleted?
        if (parentComment.deleted) {
          return res.status(400).json({
            message: `parent comment with id, ${parentComment.id}, is already deleted`,
          });
        }

        // make sub comment / reply
        const currUserId = Utility.extractUserIdFromToken(req);
        logger.info(
          `creating a sub-comment for comment,${parentCommentId}, by user with id, ${currUserId}...`
        );
        const replyCommentData: CommentModelShape = {
          user: new Types.ObjectId(<string>currUserId),
          post: new Types.ObjectId(<string>postId),
          parentComment: parentComment._id, // attach parent to child/reply
          ...req.body,
        } as const;
        const newReplyComment = await CommentModel.create({
          ...replyCommentData,
        });

        // attach child/reply to parent
        parentComment.childComments.push(newReplyComment._id);
        await parentComment.save();

        return res.status(201).json({
          message: "reply created successfully",
          reply: newReplyComment,
        });
      } catch (e) {
        logger.error(e, "error creating reply to comment");
        Utility.handle500Status(res, <Error>e);
      }
    },
  ],
  deleteReply: [
    ...idSanitizers,
    replyIdSanitizer,
    Utility.validateRequest,
    async function (req: Request, res: Response): Promise<any> {
      try {
        const parentComment = await findParentComment(req, res);
        if (!parentComment) return;

        // is the parent comment deleted?
        if (parentComment.deleted) {
          return res.status(400).json({
            message: `parent comment with id, ${parentComment.id}, is already deleted`,
          });
        }

        const deletedReply = await findCommentByIdAndPostId(req, res);
        if (!deletedReply) return;
        const replyId = deletedReply.id;

        // remove reply from parent's children
        {
          const objectIdToString = (currMongoId: Types.ObjectId): string => {
            return currMongoId._id.toHexString();
          };
          const hexUserIds = parentComment.childComments.map(objectIdToString);
          const userIdSet: Set<string> = Utility.arrayToSet(hexUserIds);
          if (!userIdSet.has(replyId)) {
            return res.status(404).json({
              message: `the current reply with id, ${replyId}, was not found among the current comment's( ${parentComment.id} ) replies`,
            });
          }
          userIdSet.delete(replyId);
          parentComment.childComments = Array.from(userIdSet).map(
            (id) => new Types.ObjectId(id)
          );
          await parentComment.save();
        }

        // delete in database
        {
          if (!isCurrUserSameAsCreator(req, res, replyId)) return;
          await markCommentAsDeleted(deletedReply);
          logger.info(
            `comment with id, ${deletedReply.id}, deleted successfully!`
          );
        }

        return res.status(204).end();
      } catch (e) {
        logger.error(e, "error deleting reply to comment");
        Utility.handle500Status(res, <Error>e);
      }
    },
  ],
  likeComment: [
    ...idSanitizers,
    Utility.validateRequest,
    async function (req: Request, res: Response): Promise<any> {
      try {
        const comment = await findCommentByIdAndPostId(req, res);
        if (!comment) return;
        logger.info("updating comment likes...");
        const updatedCommentLikes = Utility.updateUserReactions(
          req,
          res,
          comment.likes
        );
        if (!updatedCommentLikes) return;

        // if the user disliked the comment, "remove" them from dislikes
        if (comment.dislikes.length >= 1) {
          const dislikeSet = Utility.arrayToSet(comment.dislikes);
          const userId: string = Utility.extractUserIdFromToken(req);
          if (dislikeSet.has(userId)) {
            dislikeSet.delete(userId); // remove user
            comment.dislikes =
              dislikeSet.size > 0 ? Array.from(dislikeSet) : [];
          }
        }
        await comment.save();
        logger.info("comment's likes updated successfully!");
        return res.status(200).json({
          message: "comment's likes updated successfully",
          comment,
        });
      } catch (e) {
        logger.error(e, "error liking a comment");
        Utility.handle500Status(res, <Error>e);
      }
    },
  ],
  removeLike: [
    ...idSanitizers,
    Utility.validateRequest,
    async function (req: Request, res: Response): Promise<any> {
      try {
        const comment = await findCommentByIdAndPostId(req, res);
        if (!comment) return;
        if (comment.likes.length <= 0) {
          logger.info("no likes to remove from comment");
          return res.status(204).json({
            message: "there are no likes on the comment yet",
          });
        }

        // remove like
        {
          const likesSet = Utility.arrayToSet(comment.likes);
          const userId: string = Utility.extractUserIdFromToken(req);
          if (!likesSet.has(userId)) {
            logger.info("user already removed like from comment");
            return res.status(400).json({
              message: "user already removed like from comment",
            });
          }
          likesSet.delete(userId); // remove user from likes
          comment.likes = likesSet.size > 0 ? Array.from(likesSet) : [];
          await comment.save();
          logger.info("like removed from the comment successfully!");
        }

        return res.status(200).json({
          message: "comment like removed successfully!",
          comment,
        });
      } catch (e) {
        logger.error(e, "error removing a like from a comment");
        Utility.handle500Status(res, <Error>e);
      }
    },
  ],
  dislikeComment: [
    ...idSanitizers,
    Utility.validateRequest,
    async function (req: Request, res: Response): Promise<any> {
      try {
        const comment = await findCommentByIdAndPostId(req, res);
        if (!comment) return;
        logger.info("updating comment dislikes...");
        const updatedCommentDislikes = Utility.updateUserReactions(
          req,
          res,
          comment.dislikes
        );
        if (!updatedCommentDislikes) return;

        // if the user liked the comment, "remove" them from likes
        if (comment.likes.length > 0) {
          const likesSet = Utility.arrayToSet(comment.likes);
          const userId: string = Utility.extractUserIdFromToken(req);
          if (likesSet.has(userId)) {
            likesSet.delete(userId); // remove user
            comment.likes = likesSet.size > 0 ? Array.from(likesSet) : [];
          }
        }
        await comment.save();
        logger.info("comment's dislikes updated successfully!");
        return res.status(200).json({
          message: "comment's dislikes updated successfully",
          comment,
        });
      } catch (e) {
        logger.error(e, "error disliking a comment");
        Utility.handle500Status(res, <Error>e);
      }
    },
  ],
  removeDislike: [
    ...idSanitizers,
    Utility.validateRequest,
    async function (req: Request, res: Response): Promise<any> {
      try {
        const comment = await findCommentByIdAndPostId(req, res);
        if (!comment) return;
        if (comment.dislikes.length <= 0) {
          logger.info("no dislikes to remove from comment");
          return res
            .status(204)
            .json({ message: "there are no dislikes on the comment yet" });
        }

        // remove dislike
        {
          const dislikesSet = Utility.arrayToSet(comment.dislikes);
          const userId: string = Utility.extractUserIdFromToken(req);
          if (!dislikesSet.has(userId)) {
            logger.info("user already removed dislike from comment");
            return res.status(400).json({
              message: "user already removed dislike from comment",
            });
          }
          dislikesSet.delete(userId); // remove user from dislikes
          comment.dislikes =
            dislikesSet.size > 0 ? Array.from(dislikesSet) : [];
          await comment.save();
          logger.info("dislike removed from the comment successfully!");
        }
        return res.status(200).json({
          message: "comment dislike removed successfully!",
          comment,
        });
      } catch (e) {
        logger.error(e, "error removing a dislike a comment");
        Utility.handle500Status(res, <Error>e);
      }
    },
  ],
};

/**
 * find a comment's parent comment
 * @param req Request object from express
 * @param res Response object from express
 * @returns a comment document type or null in case of an error and a response is sent to the client
 */
async function findParentComment(req: Request, res: Response) {
  try {
    const parentComment = await findCommentByIdAndPostId(req, res);
    return parentComment ? parentComment : null;
  } catch (e) {
    throw e;
  }
}

/**
 * marks a comment as deleted but it sticks around
 * @param storedComment a comment's document type
 */
async function markCommentAsDeleted(storedComment: any) {
  try {
    storedComment.deleted = true;
    storedComment.detachedchildComments = [...storedComment.childComments];
    storedComment.childComments = [];
    storedComment.tldr = "";
    storedComment.body = ""; // note: might wanna change this to sth else in the future
    await storedComment.save();
  } catch (e) {
    throw e;
  }
}

/**
 * finds a comment by its id and post id
 * @param req Request object from express
 * @param res Response object from express
 * @returns a comment document type or null in case of an error and a response is sent to the client
 */
async function findCommentByIdAndPostId(req: Request, res: Response) {
  try {
    const sanitizedData = matchedData(req);
    const { postId, id: commentId } = sanitizedData;
    logger.info(
      `searching for comment with id, ${commentId}, for post with id, ${postId}...`
    );
    if (
      !Utility.validateObjectId(postId, res) ||
      !Utility.validateObjectId(commentId, res)
    ) {
      return null;
    }
    const storedComment = await CommentModel.findOne({
      _id: commentId,
      post: postId,
    });
    return validateCommentFromDb(storedComment, res) ? storedComment : null;
  } catch (e) {
    throw e;
  }
}

async function findCommentsForPost(req: Request, res: Response) {
  try {
    const sanitizedData = matchedData(req);
    const { postId } = sanitizedData;
    logger.info(`fetching comments for post with id, ${postId}...`);
    if (!isValidObjectId(postId)) {
      logger.error("invalid or malformed post id");
      res.status(400).json({
        message: `Post id, ${postId}, is invalid or malformed.`,
      });

      return null;
    }
    let storedComments = await CommentModel.find({
      post: postId,
    });
    if (storedComments.length <= 0) {
      logger.error(`No comments available for post with id, ${postId}.`);
      res.status(200).json({
        message: `No comments available for post with id, ${postId}.`,
      });

      return null;
    }

    // keep comments that are NOT deleted
    storedComments = storedComments.filter(
      (currComment) => !currComment.deleted
    );

    return storedComments;
  } catch (e) {
    throw e;
  }
}

/**
 * validates a comment from the database
 * @param comment a comment document type
 * @param res Response object from express
 * @returns a boolean representing the validity of the comment
 */
function validateCommentFromDb(comment: any | null, res: Response) {
  if (!comment) {
    logger.error("comment not found");
    res.status(404).json({ message: "comment not found" });
  } else if (comment.deleted) {
    logger.error("comment already deleted");
    res.status(400).json({ message: "comment already deleted" });
  } else return true;
  return false;
}

/**
 * checks if the current user is the "original" author of the comment
 * @param req Request object from express
 * @param res Response object from express
 * @param dbUserId a string representing the user's id from the database
 * @returns a boolean representing the validity of the user
 * and a response is sent to the client if the user is not the author
 * of the comment
 */
function isCurrUserSameAsCreator(
  req: Request,
  res: Response,
  dbUserId: string
): boolean {
  const currUserId = Utility.extractUserIdFromToken(req);
  logger.info(
    `checking if user with id, ${currUserId}, is the author of the comment...`
  );
  if (currUserId !== dbUserId) {
    logger.error(`user( ${currUserId} ) is not the author of the comment`);
    res.status(403).json({
      message: "you are not the author of this post so you will not update it",
    });
    return false;
  }
  return true;
}

export default commentController;
