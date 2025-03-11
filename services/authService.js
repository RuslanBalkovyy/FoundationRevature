const { logger } = require('../util/logger');
const { createUser, getUserByUsername } = require('../models/userModel');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');


const schema = Joi.object({
    username: Joi.string().min(3).max(16).required(),
    password: Joi.string().min(3).pattern(new RegExp('^(?=.*\\d)[A-Za-z\\d]{3,}$'))
        .required().messages({
            "string.min": "Password must be at least 3 characters long.",
            "string.pattern.base": "Password must include number."
        })
});

async function registration(user) {
    try {

        const { error, value } = schema.validate(user);
        if (error) {
            logger.error(`Error while validationg credentials: ${error.details[0].message}`);
            return { success: false, error: error.details[0].message };;
        } else {
            logger.info("Validation passed:", { username: user.username });
        }
        const existingUser = await getUserByUsername(user.username);

        if (existingUser) {
            logger.error(`Username "${user.username}" already exists in the database.`);
            return { success: false, error: "Username already exists." };
        }
        user.user_id = uuidv4();
        user.role = "employee";

        const hashedPassword = await bcrypt.hash(user.password, 5);
        user.password = hashedPassword;


        const createdUser = await createUser(user);


        logger.info(`User "${user.username}" created successfully with ID: ${user.user_id}`);
        return {
            success: true,
            user: {
                username: user.username,
                role: user.role,
                user_id: user.user_id
            }
        };
    } catch (error) {
        logger.error(`Error during registration: ${error.message}`, error);
        return { success: false, error: "An unexpected error occurred during registration." };
    }
}


async function login(user) {
    try {

        if (!user.username || !user.password) {
            return {
                success: false,
                error: "Username and password are required."
            };
        }

        const userFromDB = await getUserByUsername(user.username);
        if (!userFromDB) {
            logger.error(`User with username ${user.username} doesn't exist.`);
            return {
                success: false,
                error: "No such username in database."
            };
        }


        const matchPass = await bcrypt.compare(user.password, userFromDB.password);

        if (matchPass) {
            logger.info(`User "${user.username}" logged in successfully.`);
            const { password, ...safeUserData } = userFromDB;
            return {
                success: true,
                user: safeUserData
            };
        }
        else {
            logger.error(`User login failed. Username: ${user.username}. Reason: Password doesn't match.`);
            return {
                success: false,
                error: "Password doesn't match."
            }
        }


    } catch (error) {
        logger.error(`Error during login: ${error.message}`, error);
        return { success: false, error: "An unexpected error occurred during login." };
    }
}